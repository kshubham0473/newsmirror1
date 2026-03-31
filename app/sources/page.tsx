/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";
import styles from "./Sources.module.css";

export const revalidate = 300;

export default async function SourcesPage() {
  const supabase = createClient();

  const { data: sources } = await supabase
    .from("sources")
    .select("id, name, home_url, language")
    .order("name");

  const { data: profiles } = await supabase
    .from("source_ideology_scores")
    .select("source_id, article_sample_count");

  const profileMap = new Map<string, { article_sample_count: number }>();
  for (const row of profiles ?? []) {
    profileMap.set(row.source_id, row);
  }

  const enriched = (sources ?? []).map((s: any) => ({
    ...s,
    profile: profileMap.get(s.id) ?? null,
  }));

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <a href="/feed" className={styles.backLink}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to feed
          </a>
          <h1 className={styles.title}>Sources &amp; editorial profiles</h1>
          <p className={styles.subtitle}>
            We read each outlet over the last 90 days and infer a soft profile of how it frames
            identity, the state, the economy, and institutions. No raw scores are shown — only
            relative tendencies.
          </p>
        </header>

        <div className={styles.grid}>
          {enriched.map((source) => {
            const ready = source.profile && source.profile.article_sample_count >= 10;
            return (
              <a key={source.id} href={`/sources/${source.id}`} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.avatar}>
                    {source.name.charAt(0).toUpperCase()}
                  </div>
                  <div className={styles.cardMeta}>
                    <span className={styles.cardName}>{source.name}</span>
                    <span className={styles.cardStatus}>
                      <span className={styles.langPill}>{source.language.toUpperCase()}</span>
                      {ready ? (
                        <span className={styles.statusReady}>Profile ready</span>
                      ) : (
                        <span className={styles.statusBuilding}>Profile building</span>
                      )}
                    </span>
                  </div>
                  <svg className={styles.chevron} width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                <p className={styles.cardBody}>
                  {ready
                    ? `Based on ${source.profile!.article_sample_count} recent stories, this outlet has a distinct editorial pattern across identity, the state, economy, and institutions.`
                    : "We\'re still reading this outlet. A profile appears once we have at least 10 representative articles."}
                </p>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
