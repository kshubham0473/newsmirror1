import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase-server';
import styles from './SourceProfile.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface ClassifierRationale {
  identity?: string;
  state_trust?: string;
  economic?: string;
  institution?: string;
}

interface Article {
  id: string;
  headline: string;
  summary: string;
  classifier_rationale: ClassifierRationale | null;
  identity_score: number | null;
  state_trust_score: number | null;
  economic_score: number | null;
  institution_score: number | null;
}

interface IdeologyScore {
  identity_score: number | null;
  state_trust_score: number | null;
  economic_score: number | null;
  institution_score: number | null;
  sample_size: number | null;
}

// ── Axis config ──────────────────────────────────────────────────────────────

const AXES = [
  {
    key:      'identity_score'    as const,
    label:    'Group framing',
    lo:       'Pluralist',
    hi:       'Majoritarian',
    ratKey:   'identity'          as const,
  },
  {
    key:      'state_trust_score' as const,
    label:    'Govt coverage',
    lo:       'Sceptical',
    hi:       'Deferential',
    ratKey:   'state_trust'       as const,
  },
  {
    key:      'economic_score'    as const,
    label:    'Economic lens',
    lo:       'Welfare',
    hi:       'Market',
    ratKey:   'economic'          as const,
  },
  {
    key:      'institution_score' as const,
    label:    'Institutions',
    lo:       'Critical',
    hi:       'Deferential',
    ratKey:   'institution'       as const,
  },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAxisFill(score: number): { left: string; width: string; opacity: number } {
  const diff = score - 0.5;
  const pct  = Math.abs(diff) * 100;
  const opacity = pct < 15 ? 0.45 : pct < 30 ? 0.7 : 0.92;
  if (diff < 0) {
    return { left: `${score * 100}%`, width: `${pct}%`, opacity };
  }
  return { left: '50%', width: `${pct}%`, opacity };
}

function getStrengthLabel(
  score: number,
  lo: string,
  hi: string
): { text: string; tier: 'neutral' | 'subtle' | 'distinct' } {
  const diff = Math.abs(score - 0.5);
  if (diff < 0.12) return { text: 'Broadly neutral',              tier: 'neutral'  };
  const dir = score < 0.5 ? lo : hi;
  if (diff < 0.30) return { text: `Subtle tilt — ${dir.toLowerCase()}`,   tier: 'subtle'   };
  return              { text: `Distinct tilt — ${dir.toLowerCase()}`, tier: 'distinct' };
}

// Pick articles that have at least 2 non-null rationale fields and a non-trivial score
function pickRepresentativeArticles(articles: Article[]): Article[] {
  return articles
    .filter(a => {
      if (!a.classifier_rationale) return false;
      const fields = Object.values(a.classifier_rationale).filter(Boolean);
      return fields.length >= 2;
    })
    .slice(0, 3);
}

// Which 2 axes are most pronounced in a given article?
function dominantAxes(article: Article) {
  return AXES
    .map(ax => ({ ax, diff: Math.abs((article[ax.key] ?? 0.5) - 0.5) }))
    .filter(x => x.diff > 0.12 && article.classifier_rationale?.[x.ax.ratKey])
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 2)
    .map(x => x.ax);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function SourceProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createServerClient();

  const { data: source } = await supabase
    .from('sources')
    .select('id, name, home_url, language')
    .eq('id', params.id)
    .single();

  if (!source) notFound();

  const { data: ideology } = await supabase
    .from('source_ideology_scores')
    .select('identity_score, state_trust_score, economic_score, institution_score, sample_size')
    .eq('source_id', params.id)
    .single<IdeologyScore>();

  const hasProfile =
    ideology != null &&
    ideology.sample_size != null &&
    ideology.sample_size >= 10;

  // Representative articles — only if profile exists
  let repArticles: Article[] = [];
  if (hasProfile) {
    const { data: raw } = await supabase
      .from('articles')
      .select(
        'id, headline, summary, classifier_rationale, identity_score, state_trust_score, economic_score, institution_score'
      )
      .eq('source_id', params.id)
      .not('identity_score', 'is', null)
      .not('classifier_rationale', 'is', null)
      .order('published_at', { ascending: false })
      .limit(30);

    repArticles = pickRepresentativeArticles((raw ?? []) as Article[]);
  }

  return (
    <main className={styles.page}>

      {/* ── Back nav ── */}
      <div className={styles.nav}>
        <Link href="/sources" className={styles.back}>
          ‹ Sources
        </Link>
      </div>

      {/* ── Source hero ── */}
      <div className={styles.hero}>
        <div className={styles.heroRow}>
          <div className={styles.avatar}>{source.name.charAt(0)}</div>
          <div className={styles.heroMeta}>
            <h1 className={styles.heroName}>{source.name}</h1>
            <div className={styles.heroSub}>
              {source.language.toUpperCase()}
              {hasProfile && ` · Profile based on ${ideology!.sample_size} articles · Last 90 days`}
            </div>
            <a
              href={source.home_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.visitLink}
            >
              Visit source ↗
            </a>
          </div>
        </div>
        <p className={styles.disclaimerLine}>
          Scores reflect editorial framing patterns, not factual accuracy.{' '}
          <Link href="/methodology" className={styles.inlineLink}>How we classify →</Link>
        </p>
      </div>

      {/* ── Profile not ready ── */}
      {!hasProfile && (
        <div className={styles.buildingState}>
          <div className={styles.buildingTitle}>Profile building</div>
          <div className={styles.buildingDesc}>
            We need at least 10 classified articles to publish a profile.
            {ideology?.sample_size != null && ideology.sample_size > 0
              ? ` ${ideology.sample_size} classified so far.`
              : ' Classification is in progress.'}
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(((ideology?.sample_size ?? 0) / 10) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Axis profile ── */}
      {hasProfile && ideology && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Editorial profile</div>
          <div className={styles.axesGrid}>
            {AXES.map(axis => {
              const score    = ideology[axis.key] ?? 0.5;
              const fill     = getAxisFill(score);
              const strength = getStrengthLabel(score, axis.lo, axis.hi);
              return (
                <div key={axis.key} className={styles.axisCard}>
                  <div className={styles.axisName}>{axis.label}</div>

                  <div className={styles.axisTrackWrap}>
                    <div className={styles.axisMidline} />
                    <div
                      className={styles.axisFill}
                      style={{
                        left:    fill.left,
                        width:   fill.width,
                        opacity: fill.opacity,
                      }}
                    />
                  </div>

                  <div className={styles.axisEnds}>
                    <span>{axis.lo}</span>
                    <span>{axis.hi}</span>
                  </div>

                  <div
                    className={styles.strengthLabel}
                    data-tier={strength.tier}
                  >
                    {strength.text}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Representative articles ── */}
      {repArticles.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Representative articles</div>
          <div className={styles.storyList}>
            {repArticles.map(article => {
              const axes = dominantAxes(article);
              return (
                <div key={article.id} className={styles.storyCard}>
                  <div className={styles.storyHeadline}>{article.headline}</div>
                  {article.summary && (
                    <div className={styles.storySummary}>{article.summary}</div>
                  )}
                  {axes.length > 0 && (
                    <div className={styles.rationaleGrid}>
                      {axes.map(ax => (
                        <div key={ax.key} className={styles.rationaleChip}>
                          <div className={styles.rationaleChipLabel}>{ax.label}</div>
                          <div className={styles.rationaleChipText}>
                            {article.classifier_rationale?.[ax.ratKey]}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Methodology note ── */}
      <div className={styles.methodologyNote}>
        <p>
          This profile is based on AI classification of {ideology?.sample_size ?? 0} articles
          published in the last 90 days. Scores reflect observed framing patterns and update
          as new articles are classified. They are not a measure of factual accuracy or
          journalistic quality.{' '}
          <Link href="/methodology" className={styles.inlineLink}>
            Read our full methodology →
          </Link>
        </p>
      </div>

    </main>
  );
}
