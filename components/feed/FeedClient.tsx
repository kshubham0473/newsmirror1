"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Article, TopicId } from "@/lib/types";
import { TOPICS } from "@/lib/types";
import { usePreferences } from "@/lib/usePreferences";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import ArticleCard from "./ArticleCard";
import CardFeed from "./CardFeed";
import TopBar from "../ui/TopBar";
import TopicFilter from "../ui/TopicFilter";
import Onboarding from "../ui/Onboarding";
import RefreshBanner, { type RefreshBannerHandle } from "@/components/ui/RefreshBanner";
import styles from "./FeedClient.module.css";

const LAST_SEEN_KEY = "nm_last_seen";
const SEEN_CARDS_KEY = "nm_seen_cards";

function readSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_CARDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

interface Props {
  initialArticles: Article[];
}

type ViewMode = "cards" | "list";

/**
 * Dynamic card stack ordering.
 * Separates clustered stories (3+ sources) from singles, applies topic
 * round-robin within each group, then interleaves: 2 singles, 1 cluster.
 * This ensures significant multi-source stories surface consistently
 * without overwhelming the feed, while topic diversity is maintained.
 */
function orderCardStack(articles: Article[]): Article[] {
  const clustered = articles.filter((a) => (a.cluster_source_count ?? 0) >= 3);
  const singles   = articles.filter((a) => (a.cluster_source_count ?? 0) < 3);

  function roundRobinByTopic(items: Article[]): Article[] {
    const grouped = new Map<string, Article[]>();
    const untagged: Article[] = [];
    for (const a of items) {
      const tag = a.topic_tags?.[0];
      if (!tag) { untagged.push(a); continue; }
      if (!grouped.has(tag)) grouped.set(tag, []);
      grouped.get(tag)!.push(a);
    }
    const buckets = Array.from(grouped.values());
    const result: Article[] = [];
    let i = 0;
    while (buckets.some((b) => b.length > 0)) {
      const bucket = buckets[i % buckets.length];
      if (bucket.length > 0) result.push(bucket.shift()!);
      i++;
    }
    return [...result, ...untagged];
  }

  const orderedClustered = roundRobinByTopic(clustered);
  const orderedSingles   = roundRobinByTopic(singles);
  const result: Article[] = [];
  let ci = 0, si = 0;

  while (ci < orderedClustered.length || si < orderedSingles.length) {
    for (let j = 0; j < 2 && si < orderedSingles.length; j++) result.push(orderedSingles[si++]);
    if (ci < orderedClustered.length) result.push(orderedClustered[ci++]);
  }

  return result;
}

export default function FeedClient({ initialArticles }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const { prefs, loaded, save } = usePreferences(user);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);
  const router = useRouter();
  const refreshBannerRef = useRef<RefreshBannerHandle>(null);

  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
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

  // Read seen card IDs from localStorage on mount so fresh stories always surface first
  useEffect(() => {
    setSeenIds(readSeenIds());
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("nm_view") as ViewMode | null;
      if (saved === "list" || saved === "cards") setViewMode(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.body.style.overflow = viewMode === "list" ? "auto" : "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, [viewMode]);

  const setView = (mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem("nm_view", mode); } catch { /* ignore */ }
  };

  const handleRefresh = useCallback(() => {
    setIsReloading(true);
    router.refresh();
    setTimeout(() => setIsReloading(false), 900);
  }, [router]);

  const handleRefreshClick = useCallback(() => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } catch { /* ignore */ }
    handleRefresh();
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
    const base = initialArticles.filter((a) => {
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

    if (activeTopic) return base;

    // Split into unseen and already-swiped, apply topic diversity to each bucket,
    // then surface unseen stories first so returning users see fresh content.
    const unseen = base.filter((a) => !seenIds.has(a.id));
    const seen   = base.filter((a) =>  seenIds.has(a.id));
    return [...orderCardStack(unseen), ...orderCardStack(seen)];
  }, [initialArticles, activeTopic, prefs.topics, effectiveSources, search, seenIds]);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today   = filtered.filter((a) =>  a.published_at && new Date(a.published_at) >= todayStart);
  const earlier = filtered.filter((a) => !a.published_at || new Date(a.published_at) <  todayStart);

  const handleOnboardingDone = ({ topics, sources }: { topics: TopicId[]; sources: string[] }) => {
    save({ topics, sources, onboardingDone: true });
    setShowOnboarding(false);
  };

  const busy = isRefreshing || isReloading;

  return (
    <div className={`${styles.shell} ${viewMode === "list" ? styles.listMode : ""}`}>
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
        topics={TOPICS as unknown as { id: string; label: string }[]}
        activeTopic={activeTopic}
        onTopicChange={(id) => setActiveTopic(id as TopicId | null)}
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
        <CardFeed articles={filtered} user={user} />
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
                        user={user}
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
                      <ArticleCard key={article.id} article={article} featured={false} user={user} />
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
