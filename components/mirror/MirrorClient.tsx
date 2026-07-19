"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { getAffinity } from "@/lib/affinity";
import styles from "./MirrorClient.module.css";

/* Mirror v2 — "Your reading diet".
   Describes the COVERAGE the reader consumed, in politically familiar terms.
   Never issues a verdict about the reader. The 4 classification axes stay in
   the pipeline; here they only decide how each article's framing is labelled. */

const AXIS_KEYS = ["identity_score", "state_trust_score", "economic_score", "institution_score"] as const;

const FRAMES = {
  fav:  { label: "Establishment-friendly", color: "var(--spec-warm)" },
  crit: { label: "Establishment-critical", color: "var(--spec-cool)" },
  neu:  { label: "Centre / wire-neutral",  color: "var(--spec-mid)" },
} as const;
type FrameKey = keyof typeof FRAMES;

interface ReadRow {
  article_id: string;
  read_at: string;
  sources: { name: string } | null;
  articles: {
    identity_score: number | null;
    state_trust_score: number | null;
    economic_score: number | null;
    institution_score: number | null;
    article_clusters?: { story_clusters: { divergence_score: number | null }[] | null }[] | null;
  } | null;
}

/** Same confidence gate as the feed: ≥2 scored axes or no framing label. */
function frameOf(a: ReadRow["articles"]): FrameKey | null {
  if (!a) return null;
  const vals = AXIS_KEYS.map((k) => a[k]).filter((v): v is number => typeof v === "number" && v > 0);
  if (vals.length < 2) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return avg > 0.6 ? "fav" : avg < 0.4 ? "crit" : "neu";
}

function divergenceOf(a: ReadRow["articles"]): number {
  const sc = a?.article_clusters?.[0]?.story_clusters?.[0];
  return sc?.divergence_score ?? 0;
}

interface Stats {
  total: number;
  sourceCount: number;
  weekCount: number;
  mix: Record<FrameKey, number>;
  mixTotal: number;
  gapsSeen: number;
  gapsOpened: number;
  diet: { name: string; count: number; pct: number }[];
}

function computeStats(rows: ReadRow[], flipped: Set<string>): Stats {
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;
  const bySource = new Map<string, number>();
  const mix: Record<FrameKey, number> = { fav: 0, crit: 0, neu: 0 };
  let weekCount = 0;
  let gapsSeen = 0;
  let gapsOpened = 0;

  for (const r of rows) {
    const src = r.sources?.name ?? "Unknown";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    if (now - new Date(r.read_at).getTime() < week) weekCount++;
    const f = frameOf(r.articles);
    if (f) mix[f]++;
    if (divergenceOf(r.articles) >= 0.4) {
      gapsSeen++;
      if (flipped.has(r.article_id)) gapsOpened++;
    }
  }

  const diet = Array.from(bySource.entries())
    .map(([name, count]) => ({ name, count, pct: Math.round((count / rows.length) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    total: rows.length,
    sourceCount: bySource.size,
    weekCount,
    mix,
    mixTotal: mix.fav + mix.crit + mix.neu,
    gapsSeen,
    gapsOpened,
    diet,
  };
}

/** Blot colour follows the DIET majority — it paints what you consumed. */
function dietColor(stats: Stats | null): string {
  if (!stats || stats.mixTotal < 5) return "#B5A98C";
  const { fav, crit, neu } = stats.mix;
  if (fav > crit && fav > neu) return "#E8761A";
  if (crit > fav && crit > neu) return "#0F7E96";
  return "#B5A98C";
}

export default function MirrorClient() {
  const { user, signIn } = useAuth();
  const [rows, setRows] = useState<ReadRow[] | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // The feed locks body scroll; this page needs it back
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Flipped cards — local log, feeds the "gaps you opened" metric
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nm_flipped_cards");
      if (raw) setFlipped(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);

  // Topic diet — what the interest algorithm has learned (local, works for guests)
  const [topicDiet, setTopicDiet] = useState<{ topic: string; pct: number }[]>([]);
  useEffect(() => {
    const aff = getAffinity();
    const positives = Object.entries(aff).filter(([k, v]) => v > 0 && !k.startsWith("e:"));
    const total = positives.reduce((s, [, v]) => s + v, 0);
    if (total > 0) {
      setTopicDiet(
        positives
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([topic, v]) => ({ topic, pct: Math.round((v / total) * 100) }))
      );
    }
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const supabase = createClient();
    supabase
      .from("reading_events")
      .select("article_id, read_at, sources(name), articles(identity_score, state_trust_score, economic_score, institution_score, article_clusters(story_clusters(divergence_score)))")
      .eq("user_id", user.id)
      .order("read_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!error && data) setRows(data as unknown as ReadRow[]);
        setLoading(false);
      });
  }, [user]);

  const stats = useMemo(() => (rows ? computeStats(rows, flipped) : null), [rows, flipped]);
  const blotColor = dietColor(stats);
  const blotScale = 1 + Math.min((stats?.total ?? 0) * 0.008, 0.35);
  const pct = (n: number) => (stats && stats.mixTotal > 0 ? Math.round((n / stats.mixTotal) * 100) : 0);

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <Link href="/feed" className={styles.back}>← Briefing</Link>
        <h1 className={styles.title}>Your <em>reading diet</em></h1>
        <p className={styles.sub}>
          {user
            ? "What you consumed — not who you are. The mirror describes coverage, it doesn't judge readers."
            : "The blot only forms when someone reads."}
        </p>
      </header>
      <div className={styles.rule} />

      {/* ── the blot ── */}
      <div className={styles.blotWrap}>
        <svg viewBox="0 0 200 170" width="200" height="170" aria-hidden>
          <defs>
            <linearGradient id="mirrorBlot" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={blotColor} stopOpacity="0.95" />
              <stop offset="1" stopColor="#161310" />
            </linearGradient>
            <filter id="gooey">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b" />
              <feColorMatrix in="b" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -9" />
            </filter>
          </defs>
          <g
            filter="url(#gooey)"
            fill="url(#mirrorBlot)"
            style={{ transform: `scale(${blotScale})`, transformOrigin: "100px 85px", transition: "transform .8s cubic-bezier(.2,.7,.2,1)" }}
          >
            <path d="M100 18 C86 26 72 20 62 34 C52 48 60 58 52 72 C44 86 52 98 46 112 C41 124 52 140 66 136 C78 132.5 84 138 92 140 C96 141 100 140 100 140 L100 18 Z" />
            <path d="M100 18 C114 26 128 20 138 34 C148 48 140 58 148 72 C156 86 148 98 154 112 C159 124 148 140 134 136 C122 132.5 116 138 108 140 C104 141 100 140 100 140 L100 18 Z" />
            <circle cx="58" cy="52" r="7" />
            <circle cx="142" cy="52" r="7" />
            <circle cx="48" cy="118" r="5" />
            <circle cx="152" cy="118" r="5" />
            <circle cx="100" cy="152" r="6" />
          </g>
          <text x="100" y="88" textAnchor="middle" className={styles.blotNum}>
            {stats?.total ?? 0}
          </text>
          <text x="100" y="103" textAnchor="middle" className={styles.blotLbl}>
            STORIES READ
          </text>
        </svg>
      </div>

      {!user ? (
        <div className={styles.gate}>
          <p className={styles.gateText}>
            Sign in and your reading grows a blot no one else has — its size, colour, and
            balance are a fingerprint of <em>how</em> you read the news.
          </p>
          <button className={styles.gateBtn} onClick={signIn}>Sign in with Google</button>
        </div>
      ) : loading ? (
        <p className={styles.loading}>Developing your reflection…</p>
      ) : !stats || stats.total === 0 ? (
        <div className={styles.gate}>
          <p className={styles.gateText}>
            Your blot is still clear water. Open a few stories with <b>Read full</b> and
            come back — every read leaves a drop of ink here.
          </p>
          <Link href="/feed" className={styles.gateBtn}>Start reading →</Link>
        </div>
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statN}>{stats.total}</span><span className={styles.statL}>Stories</span></div>
            <div className={styles.stat}><span className={styles.statN}>{stats.sourceCount}</span><span className={styles.statL}>Outlets</span></div>
            <div className={styles.stat}><span className={styles.statN}>{stats.weekCount}</span><span className={styles.statL}>This week</span></div>
          </div>

          {/* ── Framing diet ── */}
          <div className={styles.secLabel}>Your framing diet</div>
          {stats.mixTotal >= 5 ? (
            <>
              <div className={styles.mixBar} role="img" aria-label="Framing mix of your reads">
                {(["crit", "neu", "fav"] as FrameKey[]).map((k) =>
                  stats.mix[k] > 0 ? (
                    <div
                      key={k}
                      className={styles.mixSeg}
                      style={{ width: `${pct(stats.mix[k])}%`, background: FRAMES[k].color }}
                    />
                  ) : null
                )}
              </div>
              <div className={styles.mixLegend}>
                {(["crit", "neu", "fav"] as FrameKey[]).map((k) => (
                  <span key={k} className={styles.mixKey}>
                    <i style={{ background: FRAMES[k].color }} />
                    {FRAMES[k].label} · <b>{pct(stats.mix[k])}%</b>
                  </span>
                ))}
              </div>
              <p className={styles.dietNote}>
                How the coverage you read framed its subjects — based on {stats.mixTotal} classified
                stories. Colours describe the framing of articles, never the truth of a story or you.
              </p>
            </>
          ) : (
            <p className={styles.dietNote}>
              Not enough classified reads yet — this fills in as you read political coverage.
            </p>
          )}

          {/* ── Framing gaps ── */}
          {stats.gapsSeen > 0 && (
            <>
              <div className={styles.secLabel}>The other side</div>
              <div className={styles.gapCard}>
                <div className={styles.gapNums}>
                  <b>{stats.gapsOpened}</b> of <b>{stats.gapsSeen}</b>
                </div>
                <p className={styles.gapText}>
                  {stats.gapsSeen} stories you read had a documented framing gap between outlets.
                  You flipped {stats.gapsOpened === 0 ? "none" : stats.gapsOpened} of them to see
                  the other side{stats.gapsOpened / stats.gapsSeen >= 0.5
                    ? " — that's conscious reading."
                    : ". The flip is one tap."}
                </p>
              </div>
            </>
          )}

          <div className={styles.secLabel}>Your sources</div>
          <div className={styles.diet}>
            {stats.diet.map((d) => (
              <div className={styles.dietRow} key={d.name}>
                <span className={styles.dietName}>{d.name}</span>
                <div className={styles.dietTrack}>
                  <div className={styles.dietFill} style={{ width: `${d.pct}%` }} />
                </div>
                <span className={styles.dietPct}>{d.pct}%</span>
              </div>
            ))}
          </div>
          {stats.sourceCount <= 2 && stats.total >= 10 && (
            <p className={styles.dietNote}>
              Nearly everything you read comes from {stats.sourceCount === 1 ? "one outlet" : "two outlets"} —
              the feed will keep offering others.
            </p>
          )}
        </>
      )}

      {topicDiet.length > 0 && (
        <>
          <div className={styles.secLabel}>What hooks you</div>
          <p className={styles.dietNote}>
            The feed learns from your reads, flips, and reactions — this is what it has learned.
            Every 6th story deliberately comes from outside this list.
          </p>
          <div className={styles.diet}>
            {topicDiet.map((d) => (
              <div className={styles.dietRow} key={d.topic}>
                <span className={styles.dietName}>{d.topic}</span>
                <div className={styles.dietTrack}>
                  <div className={styles.dietFill} style={{ width: `${d.pct}%`, background: "linear-gradient(90deg, var(--spec-warm), #E8A265)" }} />
                </div>
                <span className={styles.dietPct}>{d.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className={styles.endMark}>❦</div>
    </div>
  );
}
