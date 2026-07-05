"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import type { Article } from "@/lib/types";

/**
 * The Nudge — pool-relative reading-tilt detection.
 * See docs/nudge-design.md for the agreed spec.
 *
 * Footprint  = reader's 7-day average framing per axis
 *              (article scores where present; source profile as fallback)
 * Baseline   = sample-weighted average framing of the active source pool
 * Tilt       = footprint − baseline; nudge fires on the largest |tilt|
 */

const AXES = ["identity_score", "state_trust_score", "economic_score", "institution_score"] as const;
export type AxisKey = (typeof AXES)[number];

const MIN_SCORED_READS = 10;
const MIN_TILT = 0.08;

// Plain-language behaviour descriptions — never abstract ideology labels
const AXIS_WORDS: Record<AxisKey, { low: string; high: string; label: string }> = {
  identity_score:    { low: "pluralist-framing",        high: "majoritarian-framing",       label: "identity framing" },
  state_trust_score: { low: "state-sceptical",          high: "state-deferential",          label: "state coverage" },
  economic_score:    { low: "welfare-framing",          high: "market-framing",             label: "economic coverage" },
  institution_score: { low: "institution-critical",     high: "institution-deferential",    label: "institutional coverage" },
};

interface SourceScores {
  [sourceId: string]: Partial<Record<AxisKey, number | null>>;
}

export interface Nudge {
  article: Article;
  axis: AxisKey;
  /** -1 = reader tilts low side (needs a high-side story), +1 = the reverse */
  direction: 1 | -1;
  whyLine: string;
  tilt: number;
  footprintPos: number; // 0..1 position for the pull bar
  baselinePos: number;
}

function usable(v: number | null | undefined): v is number {
  return typeof v === "number" && v > 0;
}

export function useNudge(user: User | null, articles: Article[]): { nudge: Nudge | null } {
  const [events, setEvents] = useState<any[] | null>(null);
  const [sourceScores, setSourceScores] = useState<SourceScores | null>(null);
  const [baseline, setBaseline] = useState<Partial<Record<AxisKey, number | null>> | null>(null);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    supabase
      .from("reading_events")
      .select("article_id, source_id, articles(identity_score, state_trust_score, economic_score, institution_score)")
      .eq("user_id", user.id)
      .gte("read_at", since)
      .limit(300)
      .then(({ data }) => { if (data) setEvents(data); });

    supabase
      .from("source_ideology_scores")
      .select("source_id, identity_score, state_trust_score, economic_score, institution_score")
      .then(({ data }) => {
        if (data) {
          const map: SourceScores = {};
          for (const row of data as any[]) map[row.source_id] = row;
          setSourceScores(map);
        }
      });

    supabase
      .from("source_pool_baseline")
      .select("identity_score, state_trust_score, economic_score, institution_score")
      .single()
      .then(({ data }) => { if (data) setBaseline(data as any); });
  }, [user]);

  const nudge = useMemo<Nudge | null>(() => {
    if (!user || !events || !sourceScores || !baseline) return null;

    // 1. Footprint per axis
    const footprint: Partial<Record<AxisKey, number>> = {};
    let scoredReads = 0;

    for (const axis of AXES) {
      const vals: number[] = [];
      for (const ev of events) {
        const articleVal = ev.articles?.[axis];
        const sourceVal = sourceScores[ev.source_id]?.[axis];
        if (usable(articleVal)) vals.push(articleVal);
        else if (usable(sourceVal)) vals.push(sourceVal);
      }
      if (vals.length) footprint[axis] = vals.reduce((s, v) => s + v, 0) / vals.length;
      scoredReads = Math.max(scoredReads, vals.length);
    }

    if (scoredReads < MIN_SCORED_READS) return null;

    // 2. Largest tilt vs pool baseline
    let bestAxis: AxisKey | null = null;
    let bestTilt = 0;
    for (const axis of AXES) {
      const f = footprint[axis];
      const b = baseline[axis];
      if (f === undefined || !usable(b)) continue;
      const tilt = f - b;
      if (Math.abs(tilt) > Math.abs(bestTilt)) { bestTilt = tilt; bestAxis = axis; }
    }
    if (!bestAxis || Math.abs(bestTilt) < MIN_TILT) return null;

    const direction: 1 | -1 = bestTilt < 0 ? 1 : -1; // reader is low → nudge toward high side

    // 3. Contrast article from the already-loaded feed pool.
    //    Opposite side = source whose score on the axis sits across the baseline
    //    from the reader, by a meaningful margin.
    const b = baseline[bestAxis]!;
    const margin = 0.05;

    let seenClusters = new Set<string>();
    try {
      const raw = localStorage.getItem("nm_seen_cards");
      const seenIds: string[] = raw ? JSON.parse(raw) : [];
      const seenSet = new Set(seenIds);
      seenClusters = new Set(
        articles.filter((a) => a.cluster_id && seenSet.has(a.id)).map((a) => a.cluster_id!)
      );
    } catch { /* ignore */ }

    const isContrast = (a: Article): boolean => {
      if (!a.summary) return false;
      const articleVal = (a as any)[bestAxis];
      const sourceVal = sourceScores[a.source_id]?.[bestAxis];
      const v = usable(articleVal) ? articleVal : usable(sourceVal) ? sourceVal : null;
      if (v === null) return false;
      return direction === 1 ? v > b + margin : v < b - margin;
    };

    const candidates = articles.filter(isContrast);
    if (!candidates.length) return null;

    // Prefer a story from a cluster the reader has already seen (same story, other lens)
    const article =
      candidates.find((a) => a.cluster_id && seenClusters.has(a.cluster_id)) ?? candidates[0];

    const words = AXIS_WORDS[bestAxis];
    const readerSide = bestTilt < 0 ? words.low : words.high;
    const otherSide = bestTilt < 0 ? words.high : words.low;
    const whyLine = `Most of your ${words.label} reads this week were ${readerSide}. Here's a ${otherSide} take —`;

    return {
      article,
      axis: bestAxis,
      direction,
      whyLine,
      tilt: bestTilt,
      footprintPos: Math.min(1, Math.max(0, footprint[bestAxis]!)),
      baselinePos: Math.min(1, Math.max(0, b)),
    };
  }, [user, events, sourceScores, baseline, articles]);

  return { nudge };
}
