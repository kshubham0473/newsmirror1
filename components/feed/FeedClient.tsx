"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Article, TopicId } from "@/lib/types";
import { TOPICS } from "@/lib/types";
import { usePreferences } from "@/lib/usePreferences";
import ArticleCard from "./ArticleCard";
import CardFeed from "./CardFeed";
import TopBar from "../ui/TopBar";
import TopicFilter from "../ui/TopicFilter";
import Onboarding from "../ui/Onboarding";
import RefreshBanner, { type RefreshBannerHandle } from "@/components/ui/RefreshBanner";
import styles from "./FeedClient.module.css";

const LAST_SEEN_KEY = "nm_last_seen";

interface Props {
  initialArticles: Article[];
}

type ViewMode = "cards" | "list";

export default function FeedClient({ initialArticles }: Props) {
  const { prefs, loaded, save } = usePreferences();
  const router = useRouter();
  const refreshBannerRef = useRef<RefreshBannerHandle>(null);

  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [activeTopic, setActiveTopic] = useState<TopicId | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  useEffect(() => {
    if (loaded && !prefs.onboardingDone) setShowOnboarding(true);
  }, [loaded, prefs.onboardingDone]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("nm_view") as ViewMode | null;
      if (saved === "list" || saved === "cards") setViewMode(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.body.style.overflow = viewMode === "list" ? "auto" : "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [viewMode]);

  const setView = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("nm_view", mode);
    } catch {
      /* ignore */
    }
  };

  const handleRefresh = useCallback(() => {
    setIsReloading(true);
    router.refresh();
    setTimeout(() => setIsReloading(false), 900);
  }, [router]);

  // Refresh button: immediately reload the feed and stamp lastSeen,
  // then re-check for any further new articles via the banner.
  const handleRefreshClick = useCallback(() => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    handleRefresh();
    // After reload settles, re-check so banner shows only articles newer than now
    setTimeout(() => refreshBannerRef.current?.check(), 1000);
  }, [handleRefresh]);

  const allSources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of initialArticles) {
      if (a.sources && !seen.has(a.source_id)) {
        seen.set(a.source_id, a.sources.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [initialArticles]);

  const effectiveSources = activeSource
    ? [activeSource]
    : prefs.sources.length > 0
    ? prefs.sources
    : null;

  const filtered = useMemo(() => {
    return initialArticles.filter((a) => {
      if (activeTopic && !a.topic_tags?.includes(activeTopic)) return false;
      if (!activeTopic && prefs.topics.length > 0) {
        if (!a.topic_tags?.some((t) => prefs.topics.includes(t as TopicId))) return false;
      }
      if (effectiveSources && !effectiveSources.includes(a.source_id)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.headline.toLowerCase().includes(q) && !a.summary?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [initialArticles, activeTopic, prefs.topics, effectiveSources, search]);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = filtered.filter(
    (a) => a.published_at && new Date(a.published_at) >= todayStart
  );
  const earlier = filtered.filter(
    (a) => !a.published_at || new Date(a.published_at) < todayStart
  );

  const handleOnboardingDone = ({
    topics,
    sources,
  }: {
    topics: TopicId[];
    sources: string[];
  }) => {
    save({ topics, sources, onboardingDone: true });
    setShowOnboarding(false);
  };

  const busy = isRefreshing || isReloading;

  return (
    <div
      className={`${styles.shell} ${
        viewMode === "list" ? styles.listMode : ""
      }`}
    >
      {showOnboarding && loaded && (
        <Onboarding sources={allSources} onDone={handleOnboardingDone} />
      )}

      <TopBar
        search={search}
        onSearchChange={setSearch}
        viewMode={viewMode}
        onViewModeChange={setView}
        onSettingsClick={() => setShowOnboarding(true)}
        isRefreshing={busy}
        onRefreshClick={handleRefreshClick}
      />

      <TopicFilter
        topics={TOPICS}
        active={activeTopic}
        onChange={(id) => setActiveTopic(id as TopicId | null)}
        savedTopics={prefs.topics}
        sources={allSources}
        activeSource={activeSource}
        onSourceChange={setActiveSource}
      />

      {busy && (
        <div className={styles.progressBar} aria-hidden>
          <div className={styles.progressFill} />
        </div>
      )}

      <RefreshBanner
        ref={refreshBannerRef}
        onRefresh={handleRefresh}
        onCheckingChange={setIsRefreshing}
      />

      {busy ? (
        <div className={styles.skeletonStack} aria-hidden>
          <div className={styles.skelCard} />
          <div className={styles.skelLines}>
            <div className={styles.skelLine} />
            <div className={styles.skelLineShort} />
            <div className={styles.skelLine} />
            <div className={styles.skelLineShort} />
          </div>
        </div>
      ) : viewMode === "cards" ? (
        <CardFeed articles={filtered} />
      ) : (
        <main className={styles.listMain}>
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
                      <ArticleCard
                        key={article.id}
                        article={article}
                        featured={i === 0 && !activeTopic}
                      />
                    ))}
                  </div>
                </section>
              )}
              {earlier.length > 0 && (
                <section>
                  <h2 className={styles.sectionLabel}>Earlier</h2>
                  <div className={styles.grid}>
                    {earlier.map((article) => (
                      <ArticleCard
                        key={article.id}
                        article={article}
                        featured={false}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}
