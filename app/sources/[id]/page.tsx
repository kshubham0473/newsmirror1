/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";
import styles from "./SourceProfile.module.css";

export const revalidate = 300;

interface Props {
  params: { id: string };
}

const AXES = [
  {
    key: "identity_score",
    label: "Identity framing",
    description:
      "How often coverage centres majority vs minority communities, and whether language is plural or majoritarian.",
  },
  {
    key: "state_trust_score",
    label: "State narrative",
    description:
      "Whether government claims are questioned or largely reproduced at face value, and how often opposition voices appear.",
  },
  {
    key: "economic_score",
    label: "Economic framing",
    description:
      "Balance between growth and markets on one side, and labour, inequality, or welfare impact on the other.",
  },
  {
    key: "institution_score",
    label: "Institutional tone",
    description:
      "How courts, RBI, Election Commission and other watchdogs are described – deferential, neutral, or critical.",
  },
] as const;

function axisStrength(value: number | null | undefined): "Neutral" | "Subtle tilt" | "Distinct tilt" {
  if (value == null) return "Neutral";
  const diff = Math.abs(value - 0.5);
  if (diff < 0.15) return "Neutral";
  if (diff < 0.3) return "Subtle tilt";
  return "Distinct tilt";
}

function barWidth(value: number | null | undefined): number {
  if (value == null) return 30;
  return Math.round(30 + Math.abs(value - 0.5) * 70);
}

export default async function SourceProfilePage({ params }: Props) {
  const supabase = createClient();

  const { data: source } = await supabase
    .from("sources")
    .select("id, name, home_url, language, rss_url")
    .eq("id", params.id)
    .maybeSingle();

  if (!source) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <p className={styles.notFound}>Source not found.</p>
        </div>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("source_ideology_scores")
    .select("article_sample_count, identity_score, state_trust_score, economic_score, institution_score")
    .eq("source_id", source.id)
    .maybeSingle();

  const { data: examples } = await supabase
    .from("articles")
    .select("id, url, headline, summary, classifier_rationale")
    .eq("source_id", source.id)
    .not("summary", "is", null)
    .not("classifier_rationale", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(3);

  const ready = profile && profile.article_sample_count >= 10;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <a href="/sources" className={styles.backLink}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All sources
          </a>

          <div className={styles.sourceHeader}>
            <div className={styles.avatar}>{source.name.charAt(0).toUpperCase()}</div>
            <div className={styles.sourceHeaderMeta}>
              <h1 className={styles.title}>{source.name}</h1>
              <div className={styles.statusRow}>
                <span className={styles.langPill}>{source.language.toUpperCase()}</span>
                {ready ? (
                  <span className={styles.statusReady}>Profile ready · {profile.article_sample_count} articles</span>
                ) : (
                  <span className={styles.statusBuilding}>Profile building</span>
                )}
              </div>
            </div>
            {source.home_url && (
              <a
                href={source.home_url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.homepageLink}
              >
                Visit
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M1 10L10 1M10 1H4M10 1V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>

          <p className={styles.intro}>
            We infer this profile from how {source.name} has covered stories in the last 90 days — focusing on
            framing, emphasis, and editorial choices, not whether any single article is correct.
          </p>
        </header>

        {/* Axis cards */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Editorial dimensions</h2>
          <div className={styles.axisGrid}>
            {AXES.map((axis) => {
              const rawValue = profile ? (profile as any)[axis.key] ?? null : null;
              const strength = axisStrength(rawValue);
              const width = barWidth(rawValue);
              return (
                <div key={axis.key} className={styles.axisCard}>
                  <div className={styles.axisTop}>
                    <div>
                      <p className={styles.axisLabel}>{axis.label}</p>
                      <p className={`${styles.axisStrength} ${
                        strength === "Distinct tilt" ? styles.strengthDistinct
                        : strength === "Subtle tilt" ? styles.strengthSubtle
                        : styles.strengthNeutral
                      }`}>
                        {ready ? strength : "—"}
                      </p>
                    </div>
                    <div className={styles.barWrap}>
                      <div className={styles.barTrack}>
                        <div className={styles.barFill} style={{ width: ready ? `${width}%` : "30%" }} />
                      </div>
                      <p className={styles.barCaption}>Relative editorial weight</p>
                    </div>
                  </div>
                  <p className={styles.axisDesc}>{axis.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Representative stories */}
        {examples && examples.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Representative recent stories</h2>
            <p className={styles.sectionHint}>
              A few of the stories the model examined when shaping this profile. Rationale snippets are
              generated and show the framing the model is tracking — not verdicts on the article.
            </p>
            <div className={styles.exampleList}>
              {examples.map((a: any) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.exampleCard}
                >
                  <p className={styles.exampleHeadline}>{a.headline}</p>
                  {a.summary && (
                    <p className={styles.exampleSummary}>{a.summary}</p>
                  )}
                  {a.classifier_rationale?.rationale && (
                    <div className={styles.rationaleGrid}>
                      {a.classifier_rationale.rationale.identity && (
                        <p className={styles.rationaleItem}>
                          <span className={styles.rationaleAxis}>Identity </span>
                          {a.classifier_rationale.rationale.identity}
                        </p>
                      )}
                      {a.classifier_rationale.rationale.state_trust && (
                        <p className={styles.rationaleItem}>
                          <span className={styles.rationaleAxis}>State </span>
                          {a.classifier_rationale.rationale.state_trust}
                        </p>
                      )}
                      {a.classifier_rationale.rationale.economic && (
                        <p className={styles.rationaleItem}>
                          <span className={styles.rationaleAxis}>Economy </span>
                          {a.classifier_rationale.rationale.economic}
                        </p>
                      )}
                      {a.classifier_rationale.rationale.institution && (
                        <p className={styles.rationaleItem}>
                          <span className={styles.rationaleAxis}>Institutions </span>
                          {a.classifier_rationale.rationale.institution}
                        </p>
                      )}
                    </div>
                  )}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Methodology note */}
        <section className={styles.methodNote}>
          <p className={styles.methodText}>
            We never label any outlet as &ldquo;good&rdquo; or &ldquo;bad&rdquo;. Instead, we look at framing choices
            across many articles — which voices are quoted, what gets emphasised, and how often institutions are questioned
            or praised. Raw model scores stay behind the scenes; what you see here is a softened, human-readable summary.
          </p>
        </section>
      </div>
    </div>
  );
}
