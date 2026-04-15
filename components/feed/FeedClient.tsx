"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Article, TopicId } from "@/lib/types";
import { TOPICS } from "@/lib/types";
import { usePreferences } from "@/lib/usePreferences";
import { useAuth } from "@/lib/useAuth";
import ArticleCard from "./ArticleCard";
import CardFeed from "./CardFeed";
import Onboarding from "@/components/ui/Onboarding";
import RefreshBanner, { type RefreshBannerHandle } from "@/components/ui/RefreshBanner";
import styles from "./FeedClient.module.css";

const LAST_SEEN_KEY = "nm_last_seen";

interface Props {
  initialArticles: Article[];
}

type ViewMode = "cards" | "list";

function diversifyByTopic(articles: Article[]): Article[] {
  const grouped = new Map<string, Article[]>();
  const untagged: Article[] = [];
  for (const article of articles) {
    const tag = article.topic_tags?.[0];
    if (!tag) { untagged.push(article); continue; }
    if (!grouped.has(tag)) grouped.set(tag, []);
    grouped.get(tag)!.push(article);
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

export default function FeedClient({ initialArticles }: Props) {
  const { user } = useAuth();
  const { prefs, loaded, save } = usePreferences(user);
  const router = useRouter();
  const refreshBannerRef = useRef<RefreshBannerHandle>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [activeTopic, setActiveTopic] = useState<TopicId | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && !prefs.onboardingDone) setShowOnboarding(true);
  }, [loaded, prefs.onboardingDone]);

  useEffect(() => {
    document.body.style.overflow = viewMode === "list" ? "auto" : "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, [viewMode]);

  const handleRefresh = useCallback(() => {
    setIsReloading(true);
    router.refresh();
    setTimeout(() => setIsReloading(false), 900);
  }, [router]);

  const handleRefreshClick = useCallback(() => {
    try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ }
    handleRefresh();
    setTimeout(() => refreshBannerRef.current?.check(), 1000);
  }, [handleRefresh]);

  const allSources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of initialArticles) {
      if (a.sources && !seen.has(a.source_id)) seen.set(a.source_id, a.sources.name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [initialArticles]);

  const effectiveSources = activeSource
    ? [activeSource]
    : prefs.sources.length > 0 ? prefs.sources : null;

  const filtered = useMemo(() => {
    const base = initialArticles.filter((a) => {
      if (activeTopic && !a.topic_tags?.includes(activeTopic)) return false;
      if (!activeTopic && prefs.topics.length > 0) {
        if (!a.topic_tags?.some((t) => prefs.topics.includes(t as TopicId))) return false;
      }
      if (effectiveSources && !effectiveSources.includes(a.source_id)) return false;
      return true;
    });
    return activeTopic ? base : diversifyByTopic(base);
  }, [initialArticles, activeTopic, prefs.topics, effectiveSources]);

  const handleOnboardingDone = ({ topics, sources }: { topics: TopicId[]; sources: string[] }) => {
    save({ topics, sources, onboardingDone: true });
    setShowOnboarding(false);
  };

  const busy = isRefreshing || isReloading;
  const displayArticles = filtered.length > 0 ? filtered : initialArticles;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today   = displayArticles.filter((a) => a.published_at && new Date(a.published_at) >= todayStart);
  const earlier = displayArticles.filter((a) => !a.published_at || new Date(a.published_at) < todayStart);

  return (
    <div className={`${styles.shell} ${viewMode === "list" ? styles.listShell : ""}`}>

      {showOnboarding && loaded && (
        <Onboarding sources={allSources} onDone={handleOnboardingDone} />
      )}

      {/* ── Top bar ── */}
      <header className={styles.topbar}>
        <div className={styles.wordmark}>News<span>Mirror</span></div>
        <div className={styles.topbarRight}>
          <button
            className={`${styles.iconBtn} ${busy ? styles.iconBtnSpin : ""}`}
            onClick={handleRefreshClick}
            aria-label="Refresh"
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4A5 5 0 0 1 12 7h-1.5M2 4V1.5M2 4h2.5M12 10A5 5 0 0 1 2 7h1.5M12 10V12.5M12 10h-2.5"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className={`${styles.iconBtn} ${sourceFilterOpen ? styles.iconBtnActive : ""}`}
            onClick={() => setSourceFilterOpen((v) => !v)}
            aria-label="Filter by source"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3.5h12M3.5 7h7M6 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ── Source dropdown ── */}
      {sourceFilterOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setSourceFilterOpen(false)} />
          <div className={styles.sourceDropdown}>
            <button
              className={`${styles.sourceOption} ${!activeSource ? styles.sourceOptionActive : ""}`}
              onClick={() => { setActiveSource(null); setSourceFilterOpen(false); }}
            >All sources</button>
            {allSources.map((s) => (
              <button
                key={s.id}
                className={`${styles.sourceOption} ${activeSource === s.id ? styles.sourceOptionActive : ""}`}
                onClick={() => { setActiveSource(s.id); setSourceFilterOpen(false); }}
              >{s.name}</button>
            ))}
          </div>
        </>
      )}

      {/* ── Topic pill bar ── */}
      <div className={styles.topicBar}>
        <button
          className={`${styles.topicPill} ${!activeTopic ? styles.topicPillActive : ""}`}
          onClick={() => setActiveTopic(null)}
        >All</button>
        {TOPICS.map((t) => (
          <button
            key={t.id}
            className={`${styles.topicPill} ${activeTopic === t.id ? styles.topicPillActive : ""}`}
            onClick={() => setActiveTopic(t.id as TopicId)}
          >{t.label}</button>
        ))}
      </div>

      {busy && (
        <div className={styles.progressBar} aria-hidden>
          <div className={styles.progressFill} />
        </div>
      )}

      <RefreshBanner ref={refreshBannerRef} onRefresh={handleRefresh} onCheckingChange={setIsRefreshing} />

      {/* ── Content ── */}
      {busy ? (
        <div className={styles.skeleton} aria-hidden>
          <div className={styles.skelCard} />
        </div>
      ) : viewMode === "cards" ? (
        <CardFeed articles={displayArticles} />
      ) : (
        <main className={styles.listMain}>
          {displayArticles.length === 0 ? (
            <div className={styles.empty}><p>No stories match your filters.</p></div>
          ) : (
            <>
              {today.length > 0 && (
                <section>
                  <h2 className={styles.sectionLabel}>Today</h2>
                  <div className={styles.listGrid}>
                    {today.map((a, i) => <ArticleCard key={a.id} article={a} index={i} />)}
                  </div>
                </section>
              )}
              {earlier.length > 0 && (
                <section>
                  <h2 className={styles.sectionLabel}>Earlier</h2>
                  <div className={styles.listGrid}>
                    {earlier.map((a, i) => <ArticleCard key={a.id} article={a} index={today.length + i} />)}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      )}

      {/* ── Connected bottom nav ── */}
      <nav className={styles.bottomNavWrap} aria-label="Main navigation">
        <div className={styles.bottomNav}>
          {/* Feed / cards */}
          <button
            className={`${styles.navBtn} ${viewMode === "cards" ? styles.navBtnActive : ""}`}
            onClick={() => setViewMode("cards")}
            aria-label="Card feed"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </button>

          {/* Connector */}
          <div className={styles.navConnector} aria-hidden />

          {/* List */}
          <button
            className={`${styles.navBtn} ${viewMode === "list" ? styles.navBtnActive : ""}`}
            onClick={() => setViewMode("list")}
            aria-label="List feed"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Connector */}
          <div className={styles.navConnector} aria-hidden />

          {/* You / account */}
          <button
            className={styles.navBtn}
            onClick={() => setShowOnboarding(true)}
            aria-label="Your preferences"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M3 16a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </nav>

    </div>
  );
}
