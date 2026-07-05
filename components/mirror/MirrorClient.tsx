"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import styles from "./MirrorClient.module.css";

const AXES = [
  { key: "identity_score", label: "Identity framing", lo: "Pluralist", hi: "Majoritarian" },
  { key: "state_trust_score", label: "State narrative", lo: "Sceptical", hi: "Deferential" },
  { key: "economic_score", label: "Economic framing", lo: "Welfare", hi: "Market" },
  { key: "institution_score", label: "Institutional tone", lo: "Critical", hi: "Deferential" },
] as const;

interface ReadRow {
  read_at: string;
  sources: { name: string } | null;
  articles: {
    identity_score: number | null;
    state_trust_score: number | null;
    economic_score: number | null;
    institution_score: number | null;
  } | null;
}

interface Stats {
  total: number;
  sourceCount: number;
  weekCount: number;
  axes: Record<string, number | null>;
  diet: { name: string; count: number; pct: number }[];
  lean: number | null; // overall 0..1
}

function computeStats(rows: ReadRow[]): Stats {
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;
  const bySource = new Map<string, number>();
  const axisVals: Record<string, number[]> = {};
  let weekCount = 0;

  for (const r of rows) {
    const src = r.sources?.name ?? "Unknown";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    if (now - new Date(r.read_at).getTime() < week) weekCount++;
    for (const ax of AXES) {
      const v = r.articles?.[ax.key];
      // scores of exactly 0 are a known classifier artefact — skip them
      if (typeof v === "number" && v > 0) (axisVals[ax.key] ??= []).push(v);
    }
  }

  const axes: Record<string, number | null> = {};
  const allVals: number[] = [];
  for (const ax of AXES) {
    const vals = axisVals[ax.key] ?? [];
    axes[ax.key] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    allVals.push(...vals);
  }

  const diet = Array.from(bySource.entries())
    .map(([name, count]) => ({ name, count, pct: Math.round((count / rows.length) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    total: rows.length,
    sourceCount: bySource.size,
    weekCount,
    axes,
    diet,
    lean: allVals.length ? allVals.reduce((s, v) => s + v, 0) / allVals.length : null,
  };
}

function leanWord(lean: number | null): { word: string; color: string } {
  if (lean === null) return { word: "unformed", color: "#B5A98C" };
  if (lean < 0.4) return { word: "teal — sceptical, welfare-first", color: "#0E7C7B" };
  if (lean > 0.6) return { word: "terracotta — establishment-leaning", color: "#C4611A" };
  return { word: "balanced sand", color: "#B5A98C" };
}

export default function MirrorClient() {
  const { user, signIn } = useAuth();
  const [rows, setRows] = useState<ReadRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  // The feed locks body scroll; this page needs it back
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const supabase = createClient();
    supabase
      .from("reading_events")
      .select("read_at, sources(name), articles(identity_score, state_trust_score, economic_score, institution_score)")
      .eq("user_id", user.id)
      .order("read_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!error && data) setRows(data as unknown as ReadRow[]);
        setLoading(false);
      });
  }, [user]);

  const stats = useMemo(() => (rows ? computeStats(rows) : null), [rows]);
  const lean = leanWord(stats?.lean ?? null);
  const blotScale = 1 + Math.min((stats?.total ?? 0) * 0.008, 0.35);

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <Link href="/feed" className={styles.back}>← Briefing</Link>
        <h1 className={styles.title}>Your <em>mirror</em></h1>
        <p className={styles.sub}>
          {user ? "What your reading looks like." : "The blot only forms when someone reads."}
        </p>
      </header>
      <div className={styles.rule} />

      {/* ── the blot ── */}
      <div className={styles.blotWrap}>
        <svg viewBox="0 0 200 170" width="200" height="170" aria-hidden>
          <defs>
            <linearGradient id="mirrorBlot" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={lean.color} stopOpacity="0.95" />
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
          <p className={styles.caption}>
            Your ink runs <b style={{ color: lean.color }}>{lean.word}</b>
            {stats.weekCount > 0 ? <> · {stats.weekCount} stories this week</> : null}
          </p>

          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statN}>{stats.total}</span><span className={styles.statL}>Stories</span></div>
            <div className={styles.stat}><span className={styles.statN}>{stats.sourceCount}</span><span className={styles.statL}>Sources</span></div>
            <div className={styles.stat}><span className={styles.statN}>{stats.weekCount}</span><span className={styles.statL}>This week</span></div>
          </div>

          <div className={styles.secLabel}>Where you stand</div>
          <div className={styles.axes}>
            {AXES.map((ax) => {
              const v = stats.axes[ax.key];
              return (
                <div className={styles.axis} key={ax.key}>
                  <div className={styles.axisLbl}>
                    <span>{ax.lo}</span><b>{ax.label}</b><span>{ax.hi}</span>
                  </div>
                  <div className={styles.axisBar}>
                    <span className={styles.axisAvg} style={{ left: "50%" }} />
                    {v !== null && <span className={styles.axisYou} style={{ left: `${v * 100}%` }} />}
                  </div>
                  {v === null && <p className={styles.axisCap}>Not enough classified reads yet.</p>}
                </div>
              );
            })}
          </div>

          <div className={styles.secLabel}>Your diet</div>
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
        </>
      )}

      <div className={styles.endMark}>❦</div>
    </div>
  );
}
