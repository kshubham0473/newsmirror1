import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import ScrollableLayout from "@/components/ui/ScrollableLayout";
import TimelineFollow from "./TimelineFollow";
import styles from "./TimelinePage.module.css";

export const revalidate = 900; // 15 min ISR

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineArticle {
  id: string;
  url: string;
  headline: string;
  summary: string | null;
  published_at: string | null;
  identity_score: number | null;
  state_trust_score: number | null;
  economic_score: number | null;
  institution_score: number | null;
  sources: {
    id: string;
    name: string;
    home_url: string;
    language: string;
  } | null;
}

// ── Axis config ───────────────────────────────────────────────────────────────

const AXES = [
  { key: "identity_score"    as const, label: "Group framing",  lo: "Pluralist",  hi: "Majoritarian" },
  { key: "state_trust_score" as const, label: "Govt coverage",  lo: "Sceptical",  hi: "Deferential"  },
  { key: "economic_score"    as const, label: "Economic lens",  lo: "Welfare",    hi: "Market"       },
  { key: "institution_score" as const, label: "Institutions",   lo: "Critical",   hi: "Deferential"  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function getDateKey(dateStr: string | null): string {
  if (!dateStr) return "unknown";
  return new Date(dateStr).toISOString().slice(0, 10);
}

function leanLabel(score: number | null, lo: string, hi: string): {
  text: string;
  side: "lo" | "hi" | "neutral";
} {
  if (score === null) return { text: "—", side: "neutral" };
  const diff = score - 0.5;
  if (Math.abs(diff) < 0.12) return { text: "Neutral", side: "neutral" };
  if (diff < 0) return { text: lo, side: "lo" };
  return { text: hi, side: "hi" };
}

function barFill(score: number | null): { left: string; width: string } | null {
  if (score === null) return null;
  const diff = score - 0.5;
  const pct = Math.abs(diff) * 100;
  if (pct < 2) return null;
  if (diff < 0) return { left: `${score * 100}%`, width: `${pct}%` };
  return { left: "50%", width: `${pct}%` };
}

function dominantLean(article: TimelineArticle): string | null {
  const entries = AXES
    .map((ax) => ({ label: ax.label, score: article[ax.key], lo: ax.lo, hi: ax.hi }))
    .filter((e) => e.score !== null)
    .map((e) => ({ ...e, diff: Math.abs((e.score as number) - 0.5) }))
    .sort((a, b) => b.diff - a.diff);
  const top = entries[0];
  if (!top || top.diff < 0.12) return null;
  const dir = (top.score as number) < 0.5 ? top.lo : top.hi;
  return `${top.label}: ${dir}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TimelinePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createServerClient();

  // 1. Load the cluster
  const { data: cluster } = await supabase
    .from("story_clusters")
    .select("id, canonical_headline, created_at")
    .eq("id", params.id)
    .single();

  if (!cluster) notFound();

  // 2. Load articles — sorted oldest first for the timeline
  const { data: clusterArticles } = await supabase
    .from("article_clusters")
    .select(`
      article_id,
      articles (
        id, url, headline, summary, published_at,
        identity_score, state_trust_score, economic_score, institution_score,
        sources ( id, name, home_url, language )
      )
    `)
    .eq("cluster_id", params.id);

  const articles: TimelineArticle[] = (clusterArticles ?? [])
    .map((row: any) => row.articles)
    .filter(Boolean)
    .sort((a: TimelineArticle, b: TimelineArticle) => {
      // Chronological: oldest first
      const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
      return aTime - bTime;
    });

  if (articles.length === 0) notFound();

  // 3. Get current user + follow state
  const { data: { user } } = await supabase.auth.getUser();
  let isFollowing = false;
  if (user) {
    const { data: follow } = await supabase
      .from("cluster_follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("cluster_id", params.id)
      .maybeSingle();
    isFollowing = !!follow;
  }

  // 4. Determine axes with 2+ scored sources
  const scoredAxes = AXES.filter((ax) =>
    articles.filter((a) => a[ax.key] !== null).length >= 2
  );

  const sourceCount = articles.length;
  const firstArticle = articles[0];
  const lastArticle = articles[articles.length - 1];

  // 5. Group articles by date for the timeline
  const dateGroups: { dateKey: string; label: string; articles: TimelineArticle[] }[] = [];
  for (const article of articles) {
    const key = getDateKey(article.published_at);
    const existing = dateGroups.find((g) => g.dateKey === key);
    if (existing) {
      existing.articles.push(article);
    } else {
      dateGroups.push({
        dateKey: key,
        label: formatDate(article.published_at),
        articles: [article],
      });
    }
  }

  return (
    <ScrollableLayout>
      <main className={styles.page}>

        {/* ── Nav ── */}
        <div className={styles.nav}>
          <Link href="/feed" className={styles.back}>‹ Feed</Link>
          <TimelineFollow
            clusterId={params.id}
            userId={user?.id ?? null}
            initialFollowing={isFollowing}
          />
        </div>

        {/* ── Hero ── */}
        <div className={styles.hero}>
          <div className={styles.heroMeta}>
            <span className={styles.sourcesCount}>{sourceCount} {sourceCount === 1 ? "source" : "sources"}</span>
            <span className={styles.dot} aria-hidden>·</span>
            <span className={styles.age}>{timeAgo(lastArticle.published_at)}</span>
            <span className={styles.dot} aria-hidden>·</span>
            <span className={styles.timelineLabel}>Story timeline</span>
          </div>
          <h1 className={styles.headline}>{cluster.canonical_headline}</h1>
          <p className={styles.subline}>
            How this story developed across{" "}
            {sourceCount === 1 ? "1 outlet" : `${sourceCount} outlets`}
          </p>
        </div>

        {/* ── Timeline ── */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Coverage timeline</div>
          <div className={styles.timeline}>
            {dateGroups.map((group, gi) => (
              <div key={group.dateKey} className={styles.dateGroup}>

                {/* Date marker */}
                <div className={styles.dateMarker}>
                  <div className={styles.dateMarkerLine} />
                  <span className={styles.dateMarkerLabel}>{group.label}</span>
                  <div className={styles.dateMarkerLine} />
                </div>

                {/* Articles in this date group */}
                {group.articles.map((article, ai) => {
                  const isFirst = gi === 0 && ai === 0;
                  const isLast  = gi === dateGroups.length - 1 && ai === group.articles.length - 1;
                  const lean    = dominantLean(article);
                  return (
                    <div key={article.id} className={styles.timelineEntry}>

                      {/* Left rail */}
                      <div className={styles.rail}>
                        <div className={`${styles.railLine} ${styles.railTop} ${isFirst ? styles.railHidden : ""}`} />
                        <div className={`${styles.railDot} ${isFirst ? styles.railDotFirst : ""}`} />
                        <div className={`${styles.railLine} ${styles.railBottom} ${isLast ? styles.railHidden : ""}`} />
                      </div>

                      {/* Entry card */}
                      <div className={styles.entryCard}>
                        <div className={styles.entryMeta}>
                          <Link href={`/sources/${article.sources?.id}`} className={styles.entrySource}>
                            {article.sources?.name ?? "Unknown"}
                          </Link>
                          {article.published_at && (
                            <span className={styles.entryTime}>{formatTime(article.published_at)}</span>
                          )}
                          {isFirst && <span className={styles.badgeFirst}>First</span>}
                          {isLast && sourceCount > 1 && <span className={styles.badgeLatest}>Latest</span>}
                          {lean && <span className={styles.leanPill}>{lean}</span>}
                        </div>

                        <h2 className={styles.entryHeadline}>{article.headline}</h2>

                        {article.summary && (
                          <p className={styles.entrySummary}>{article.summary}</p>
                        )}

                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.readBtn}
                        >
                          Read full story
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                            <path d="M1 9L9 1M9 1H4M9 1V6" stroke="currentColor"
                              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </a>
                      </div>

                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* ── Framing comparison — only if 2+ scored sources ── */}
        {scoredAxes.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Framing comparison</div>
            <p className={styles.sectionNote}>
              These scores reflect how each outlet framed this specific story —
              not their overall editorial profile.
            </p>

            <div className={styles.comparisonTable}>
              {/* Header row */}
              <div className={styles.tableHeader}>
                <div className={styles.tableCorner} />
                {articles
                  .filter((a) => scoredAxes.some((ax) => a[ax.key] !== null))
                  .map((a) => (
                    <div key={a.id} className={styles.tableSourceCol}>
                      <Link href={`/sources/${a.sources?.id}`} className={styles.tableSourceName}>
                        {a.sources?.name ?? "Unknown"}
                      </Link>
                    </div>
                  ))}
              </div>

              {/* One row per axis */}
              {scoredAxes.map((ax) => {
                const scoredArticles = articles.filter((a) => a[ax.key] !== null);
                return (
                  <div key={ax.key} className={styles.tableRow}>
                    <div className={styles.tableAxisLabel}>
                      <span className={styles.axisName}>{ax.label}</span>
                      <span className={styles.axisEnds}>{ax.lo} → {ax.hi}</span>
                    </div>
                    {scoredArticles.map((a) => {
                      const lean = leanLabel(a[ax.key], ax.lo, ax.hi);
                      const fill = barFill(a[ax.key]);
                      return (
                        <div key={a.id} className={styles.tableCell}>
                          <div className={styles.miniTrack}>
                            <div className={styles.miniMidline} />
                            {fill && (
                              <div
                                className={styles.miniFill}
                                style={{ left: fill.left, width: fill.width }}
                              />
                            )}
                          </div>
                          <span className={styles.leanLabel} data-side={lean.side}>
                            {lean.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Methodology note ── */}
        <div className={styles.methodologyNote}>
          <p>
            Framing scores are generated by AI classification and reflect editorial choices
            in how each outlet covered this specific story.{" "}
            <Link href="/methodology" className={styles.inlineLink}>
              Read our full methodology →
            </Link>
          </p>
        </div>

      </main>
    </ScrollableLayout>
  );
}
