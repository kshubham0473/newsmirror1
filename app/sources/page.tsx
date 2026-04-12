import Link from 'next/link';
import { createServerClient } from '@/lib/supabase-server';
import ScrollableLayout from '@/components/ui/ScrollableLayout';
import styles from './Sources.module.css';

interface SourceRow {
  id: string;
  name: string;
  home_url: string;
  language: string;
  active: boolean;
  ideology: {
    identity_score: number | null;
    state_trust_score: number | null;
    economic_score: number | null;
    institution_score: number | null;
    sample_size: number | null;
  } | null;
}

const AXES = [
  { key: 'identity_score',     label: 'Group framing',  lo: 'Pluralist',  hi: 'Majoritarian' },
  { key: 'state_trust_score',  label: 'Govt coverage',  lo: 'Sceptical',  hi: 'Deferential'  },
  { key: 'economic_score',     label: 'Economic lens',  lo: 'Welfare',    hi: 'Market'       },
  { key: 'institution_score',  label: 'Institutions',   lo: 'Critical',   hi: 'Deferential'  },
] as const;

function getAxisFill(score: number): { left: string; width: string; opacity: number } {
  const diff = score - 0.5;
  const pct = Math.abs(diff) * 100;
  const opacity = pct < 15 ? 0.45 : pct < 30 ? 0.7 : 0.92;
  if (diff < 0) {
    return { left: `${(score) * 100}%`, width: `${pct}%`, opacity };
  } else {
    return { left: '50%', width: `${pct}%`, opacity };
  }
}

export default async function SourcesPage() {
  const supabase = createServerClient();

  const { data: sources } = await supabase
    .from('sources')
    .select('id, name, home_url, language, active')
    .eq('active', true)
    .order('name');

  const { data: ideologyRows } = await supabase
    .from('source_ideology_scores')
    .select('source_id, identity_score, state_trust_score, economic_score, institution_score, sample_size');

  const ideologyMap = new Map(
    (ideologyRows ?? []).map(r => [r.source_id, r])
  );

  const enriched: SourceRow[] = (sources ?? []).map(s => ({
    ...s,
    ideology: ideologyMap.get(s.id) ?? null,
  }));

  const ready    = enriched.filter(s => s.ideology?.sample_size != null && s.ideology.sample_size >= 10);
  const building = enriched.filter(s => !s.ideology || (s.ideology.sample_size ?? 0) < 10);

  return (
    <ScrollableLayout>
    <main className={styles.page}>
      {/* ── Sticky mini-header with back nav ── */}
      <div className={styles.stickyNav}>
        <Link href="/feed" className={styles.navBack}>← Feed</Link>
        <span className={styles.navTitle}>Sources</span>
      </div>

      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>Source profiles</h1>
        <p className={styles.heroSub}>
          How each outlet frames the news — across four editorial dimensions specific to Indian media.
        </p>
      </div>

      {ready.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Profile ready</div>
          <div className={styles.list}>
            {ready.map(source => (
              <Link key={source.id} href={`/sources/${source.id}`} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.avatar}>
                    {source.name.charAt(0)}
                  </div>
                  <div className={styles.cardMeta}>
                    <div className={styles.cardName}>{source.name}</div>
                    <div className={styles.cardSub}>
                      {source.language.toUpperCase()} · {source.ideology?.sample_size ?? 0} articles in profile
                    </div>
                  </div>
                  <div className={styles.readyBadge}>Profile ready</div>
                  <div className={styles.chevron}>›</div>
                </div>

                <div className={styles.axisGrid}>
                  {AXES.map(axis => {
                    const score = source.ideology?.[axis.key] ?? 0.5;
                    const fill = getAxisFill(score);
                    return (
                      <div key={axis.key} className={styles.axisMini}>
                        <div className={styles.axisMiniLabel}>{axis.label}</div>
                        <div className={styles.axisTrack}>
                          <div className={styles.axisMidline} />
                          <div
                            className={styles.axisFill}
                            style={{
                              left: fill.left,
                              width: fill.width,
                              opacity: fill.opacity,
                            }}
                          />
                        </div>
                        <div className={styles.axisEnds}>
                          <span>{axis.lo}</span>
                          <span>{axis.hi}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {building.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Building profile</div>
          <div className={styles.list}>
            {building.map(source => {
              const count = source.ideology?.sample_size ?? 0;
              const pct   = Math.min((count / 10) * 100, 100);
              return (
                <div key={source.id} className={`${styles.card} ${styles.cardBuilding}`}>
                  <div className={styles.cardHeader}>
                    <div className={`${styles.avatar} ${styles.avatarDim}`}>
                      {source.name.charAt(0)}
                    </div>
                    <div className={styles.cardMeta}>
                      <div className={styles.cardName}>{source.name}</div>
                      <div className={styles.cardSub}>
                        {source.language.toUpperCase()} · {count} of 10 articles needed
                      </div>
                    </div>
                    <div className={styles.buildingBadge}>Building…</div>
                  </div>
                  <div className={styles.progressTrack}>
                    <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.methodologyNote}>
        Profiles are based on AI classification of editorial framing patterns.{' '}
        <Link href="/methodology" className={styles.methodologyLink}>
          How we classify →
        </Link>
      </div>
    </main>
    </ScrollableLayout>
  );
}
