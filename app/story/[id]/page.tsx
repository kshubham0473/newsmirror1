import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import ScrollableLayout from "@/components/ui/ScrollableLayout";
import styles from "./StoryPage.module.css";

export const revalidate = 1800; // 30 min ISR

// ── Types ─────────────────────────────────────────────────────────────────────

interface StoryArticle {
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
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Returns a lean label for a single axis score
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

// Bar fill position and width for a score
function barFill(score: number | null): { left: string; width: string } | null {
  if (score === null) return null;
  const diff = score - 0.5;
  const pct = Math.abs(diff) * 100;
  if (pct < 2) return null;
  if (diff < 0) return { left: `${score * 100}%`, width: `${pct}%` };
  return { left: "50%", width: `${pct}%` };
}

// Pick the single most deviant axis for a source card badge
function dominantLean(article: StoryArticle): string | null {
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

export default async function StoryPage({
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

  // 2. Load all articles in this cluster with source + scores
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

  const articles: StoryArticle[] = (clusterArticles ?? [])
    .map((row: any) => row.articles)
    .filter(Boolean)
    .sort((a: StoryArticle, b: StoryArticle) => {
      // Sort: articles with scores first, then by recency
      const aHasScore = a.identity_score !== null;
      const bHasScore = b.identity_score !== null;
      if (aHasScore && !bHasScore) return -1;
      if (!aHasScore && bHasScore) return 1;
      return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
    });

  if (articles.length === 0) notFound();

  // 3. Determine which axes have at least 2 sources with scores (worth showing)
  const scoredAxes = AXES.filter((ax) =>
    articles.filter((a) => a[ax.key] !== null).length >= 2
  );

  const sourceCount = articles.length;

  return (
    <ScrollableLayout>
      <main className={styles.page}>

        {/* ── Back nav ── */}
        <div className={styles.nav}>
          <Link href="/feed" className={styles.back}>
            ‹ Feed
          </Link>
        </div>

        {/* ── Story hero ── */}
        <div className={styles.hero}>
          <div className={styles.heroMeta}>
            <span className={styles.sourcesCount}>{sourceCount} sources</span>
            <span className={styles.dot} aria-hidden>·</span>
            <span className={styles.age}>{timeAgo(articles[0].published_at)}</span>
          </div>
          <h1 className={styles.headline}>{cluster.canonical_headline}</h1>
          <p className={styles.subline}>
            How different outlets covered this story
          </p>
        </div>

        {/* ── Framing comparison — only if 2+ scored sources ── */}
        {scoredAxes.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Framing comparison</div>
            <p className={styles.sectionNote}>
              These scores reflect how each outlet framed this specific article —
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
                      <Link
                        href={`/sources/${a.sources?.id}`}
                        className={styles.tableSourceName}
                      >
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
                      <span className={styles.axisEnds}>
                        {ax.lo} → {ax.hi}
                      </span>
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
                          <span
                            className={styles.leanLabel}
                            data-side={lean.side}
                          >
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

        {/* ── Source cards ── */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Coverage by source</div>
          <div className={styles.cards}>
            {articles.map((article) => {
              const lean = dominantLean(article);
              return (
                <div key={article.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardSource}>
                      <Link
                        href={`/sources/${article.sources?.id}`}
                        className={styles.cardSourceName}
                      >
                        {article.sources?.name ?? "Unknown"}
                      </Link>
                      <span className={styles.cardAge}>
                        {timeAgo(article.published_at)}
                      </span>
                    </div>
                    {lean && (
                      <span className={styles.leanPill}>{lean}</span>
                    )}
                  </div>

                  <h2 className={styles.cardHeadline}>{article.headline}</h2>

                  {article.summary && (
                    <p className={styles.cardSummary}>{article.summary}</p>
                  )}

                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.readBtn}
                  >
                    Read full story
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path
                        d="M1 10L10 1M10 1H4M10 1V7"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                </div>
              );
            })}
          </div>
        </section>

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
