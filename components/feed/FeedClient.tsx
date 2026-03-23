"use client";

import { useState, useMemo } from "react";
import type { Article } from "@/lib/types";
import { TOPICS } from "@/lib/types";
import ArticleCard from "./ArticleCard";
import TopBar from "../ui/TopBar";
import TopicFilter from "../ui/TopicFilter";
import styles from "./FeedClient.module.css";

interface Props {
  initialArticles: Article[];
}

export default function FeedClient({ initialArticles }: Props) {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Unique sources from articles
  const sources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of initialArticles) {
      if (a.sources && !seen.has(a.source_id)) {
        seen.set(a.source_id, a.sources.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [initialArticles]);

  const filtered = useMemo(() => {
    return initialArticles.filter((a) => {
      if (activeTopic && !a.topic_tags?.includes(activeTopic)) return false;
      if (activeSource && a.source_id !== activeSource) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !a.headline.toLowerCase().includes(q) &&
          !a.summary?.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [initialArticles, activeTopic, activeSource, search]);

  // Group: today vs earlier
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = filtered.filter(
    (a) => a.published_at && new Date(a.published_at) >= todayStart
  );
  const earlier = filtered.filter(
    (a) => !a.published_at || new Date(a.published_at) < todayStart
  );

  return (
    <div className={styles.shell}>
      <TopBar
        sources={sources}
        activeSource={activeSource}
        onSourceChange={setActiveSource}
        search={search}
        onSearchChange={setSearch}
      />

      <TopicFilter
        topics={TOPICS}
        active={activeTopic}
        onChange={setActiveTopic}
      />

      <main className={styles.main}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <p>No stories match your filters.</p>
          </div>
        ) : (
          <>
            {today.length > 0 && (
              <section>
                <h2 className={styles.sectionLabel}>Today</h2>
                <div className={styles.grid}>
                  {today.map((article, i) => (
                    <ArticleCard key={article.id} article={article} featured={i === 0 && !activeTopic} />
                  ))}
                </div>
              </section>
            )}
            {earlier.length > 0 && (
              <section>
                <h2 className={styles.sectionLabel}>Earlier</h2>
                <div className={styles.grid}>
                  {earlier.map((article) => (
                    <ArticleCard key={article.id} article={article} featured={false} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
