"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Article } from "@/lib/types";
import FlipCard, { type ArticleWithFraming } from "./FlipCard";
import NudgeCard from "./NudgeCard";
import type { Nudge } from "@/lib/useNudge";
import { decodeEntities } from "@/lib/decodeEntities";
import { recordSignal, SIGNAL } from "@/lib/affinity";
import { createClient } from "@/lib/supabase";
import styles from "./SnapFeed.module.css";

// Dwelling this long on a card counts as reading it (summary-first app)
const DWELL_MS = 8000;

const SEEN_KEY = "nm_seen_cards";
const SEEN_CAP = 200;

function markSeen(articleId: string) {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(articleId)) {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...ids, articleId].slice(-SEEN_CAP)));
    }
  } catch { /* ignore */ }
}

const SPEC_COLORS = ["var(--spec-cool)", "var(--spec-mid)", "var(--spec-warm)"];

function specColor(a: Article): string {
  const vals = [a.identity_score, a.state_trust_score, a.economic_score, a.institution_score]
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (!vals.length) return SPEC_COLORS[1];
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return avg < 0.4 ? SPEC_COLORS[0] : avg > 0.6 ? SPEC_COLORS[2] : SPEC_COLORS[1];
}

function timeAgoShort(dateStr: string | null): string {
  if (!dateStr) return "";
  const hrs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
  if (hrs < 1) return "now";
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Feed slots: 4 full cards, then 1 digest of 6 briefs, repeating.
 *  When a nudge is armed, it takes the 6th slot (after the first digest). */
type Slot =
  | { kind: "story"; article: ArticleWithFraming; position: number }
  | { kind: "digest"; briefs: ArticleWithFraming[]; index: number }
  | { kind: "nudge" }
  | { kind: "end" };

const NUDGE_SLOT = 5; // zero-based: after 4 stories + 1 digest

function buildSlots(articles: ArticleWithFraming[], hasNudge: boolean): Slot[] {
  const slots: Slot[] = [];
  let i = 0;
  let position = 0;
  let digestIndex = 0;
  while (i < articles.length) {
    for (let c = 0; c < 4 && i < articles.length; c++) {
      position++;
      slots.push({ kind: "story", article: articles[i++], position });
    }
    if (i < articles.length) {
      const briefs = articles.slice(i, i + 6);
      i += 6;
      slots.push({ kind: "digest", briefs, index: digestIndex++ });
    }
  }
  if (hasNudge) {
    slots.splice(Math.min(NUDGE_SLOT, slots.length), 0, { kind: "nudge" });
  }
  slots.push({ kind: "end" });
  return slots;
}

interface Props {
  articles: ArticleWithFraming[];
  user?: User | null;
  /** Armed nudge from useNudge — rendered as a special card in the flow */
  nudge?: Nudge | null;
  /** Called with the number of screens advanced this session (feeds the blot) */
  onAdvance?: (count: number) => void;
}

export default function SnapFeed({ articles, user = null, nudge = null, onAdvance }: Props) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0.04);
  const [readCount, setReadCount] = useState(0);
  const seenIdx = useRef(new Set<number>());

  // Exclude the nudge's article from regular slots so it doesn't appear twice
  const slots = useMemo(() => {
    const pool = nudge ? articles.filter((a) => a.id !== nudge.article.id) : articles;
    return buildSlots(pool, !!nudge);
  }, [articles, nudge]);

  // Observe which slot is snapped → reveal animations, seen-marking, dwell tracking
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const sections = Array.from(feed.querySelectorAll(`.${styles.snap}`));
    const activeSince = new Map<number, number>();
    const dwellLogged = new Set<string>();

    const logDwell = (idx: number) => {
      const started = activeSince.get(idx);
      activeSince.delete(idx);
      if (!started) return;
      const ms = Date.now() - started;
      const slot = slots[idx];
      if (ms < DWELL_MS || slot?.kind !== "story" || dwellLogged.has(slot.article.id)) return;
      dwellLogged.add(slot.article.id);
      // Long dwell = reading the summary — the core act in a summary-first app
      recordSignal(slot.article.topic_tags, SIGNAL.dwell);
      if (user) {
        createClient()
          .from("reading_events")
          .insert({
            user_id: user.id,
            article_id: slot.article.id,
            source_id: slot.article.source_id,
            read_at: new Date().toISOString(),
            time_spent_seconds: Math.round(ms / 1000),
          })
          .then(({ error }) => { if (error) console.warn("dwell event write failed:", error.message); });
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = sections.indexOf(e.target);
          const nowActive = e.intersectionRatio > 0.6;
          e.target.classList.toggle("snapActive", nowActive);
          if (idx < 0) continue;
          if (nowActive) {
            if (!activeSince.has(idx)) activeSince.set(idx, Date.now());
            if (!seenIdx.current.has(idx)) {
              seenIdx.current.add(idx);
              setReadCount(seenIdx.current.size);
              onAdvance?.(seenIdx.current.size);
              const slot = slots[idx];
              if (slot?.kind === "story") markSeen(slot.article.id);
            }
          } else {
            logDwell(idx);
          }
        }
      },
      { root: feed, threshold: [0.6] }
    );
    sections.forEach((s) => io.observe(s));
    return () => {
      // Flush any dwell still in progress when the feed unmounts
      for (const idx of Array.from(activeSince.keys())) logDwell(idx);
      io.disconnect();
    };
  }, [slots, onAdvance, user]);

  const onScroll = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const max = feed.scrollHeight - feed.clientHeight;
    if (max > 0) setProgress(Math.max(0.04, feed.scrollTop / max));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.thread} aria-hidden>
        <i style={{ width: `${progress * 100}%` }} />
      </div>

      <div className={styles.feed} ref={feedRef} onScroll={onScroll}>
        {slots.map((slot, i) => {
          if (slot.kind === "story") {
            return (
              <section className={`${styles.snap} ${i === 0 ? "snapActive" : ""}`} key={slot.article.id}>
                <FlipCard article={slot.article} position={slot.position} user={user} />
              </section>
            );
          }
          if (slot.kind === "nudge" && nudge) {
            return (
              <section className={styles.snap} key="nudge">
                <NudgeCard nudge={nudge} user={user} />
              </section>
            );
          }
          if (slot.kind === "digest") {
            return (
              <section className={styles.snap} key={`digest-${slot.index}`}>
                <div className={styles.digest}>
                  <div className={styles.dHead}>
                    <div className={styles.dKick}>60-second catch-up</div>
                    <h2 className={styles.dTitle}>Six more, <em>briefly</em></h2>
                  </div>
                  <div className={styles.dList}>
                    {slot.briefs.map((b, j) => (
                      <a
                        key={b.id}
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.brief}
                      >
                        <i
                          className={`${styles.bDot} ${j < 2 ? styles.bDotPing : ""}`}
                          style={{ background: specColor(b), color: specColor(b) }}
                        />
                        <h4>{decodeEntities(b.headline)}</h4>
                        <span>{b.sources?.name ?? ""} · {timeAgoShort(b.published_at ?? b.ingested_at)}</span>
                      </a>
                    ))}
                  </div>
                  <div className={styles.dFoot}>Keep flicking for full stories</div>
                </div>
              </section>
            );
          }
          if (slot.kind !== "end") return null;
          return (
            <section className={styles.snap} key="end">
              <div className={styles.endCard}>
                <svg viewBox="0 0 60 52" width="60" height="52" aria-hidden>
                  <path
                    d="M30 6 C22 10 14 8 10 16 C6 24 12 28 10 36 C9 42 16 48 22 44 C26 41.4 28 43 30 43 C32 43 34 41.4 38 44 C44 48 51 42 50 36 C48 28 54 24 50 16 C46 8 38 10 30 6 Z"
                    fill="#5BBFB4" opacity="0.9"
                  />
                </svg>
                <div className={styles.endFin}>That&rsquo;s today.</div>
                <p>You moved through <b>{readCount}</b> screens this session.<br />Fresh stories land every hour.</p>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
