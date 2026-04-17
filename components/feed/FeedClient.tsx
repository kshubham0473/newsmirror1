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
const ADMIN_EMAIL = "shubhamk0473@gmail.com"; // only this account sees admin link

interface Props {
  initialArticles: Article[];
}

type ViewMode = "cards" | "list";

function orderCardStack(articles: Article[]): Article[] {
  // Step 1: Separate clustered (multi-source) stories from singles
  // Clustered stories get a priority boost — they represent significant coverage
  const clustered  = articles.filter((a) => (a.cluster_source_count ?? 0) >= 3);
  const singles    = articles.filter((a) => (a.cluster_source_count ?? 0) < 3);

  // Step 2: Round-robin by topic within each group to enforce topic diversity
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

  // Step 3: Interleave — every 3rd card is a clustered story (if available)
  // so the stack feels: single, single, cluster, single, single, cluster...
  const orderedClustered = roundRobinByTopic(clustered);
  const orderedSingles   = roundRobinByTopic(singles);
  const result: Article[] = [];
  let ci = 0; // clustered index
  let si = 0; // singles index

  while (ci < orderedClustered.length || si < orderedSingles.length) {
    // Push 2 singles then 1 clustered
    for (let j = 0; j < 2 && si < orderedSingles.length; j++) {
      result.push(orderedSingles[si++]);
    }
    if (ci < orderedClustered.length) {
      result.push(orderedClustered[ci++]);
    }
  }

  return result;
}

export default function FeedClient({ initialArticles }: Props) {
  const { user } = useAuth();
  const { prefs, loaded, save } = usePreferences(user);
  const router = useRouter();
  const refreshBannerRef = useRef<RefreshBannerHandle>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [activeTopic, setActiveTopic] = useState<TopicId | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showYou, setShowYou] = useState(false);
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
    return activeTopic ? base : orderCardStack(base);
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
        <CardFeed articles={displayArticles} user={user} />
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
                    {today.map((a, i) => <ArticleCard key={a.id} article={a} index={i} user={user} />)}
                  </div>
                </section>
              )}
              {earlier.length > 0 && (
                <section>
                  <h2 className={styles.sectionLabel}>Earlier</h2>
                  <div className={styles.listGrid}>
                    {earlier.map((a, i) => <ArticleCard key={a.id} article={a} index={today.length + i} user={user} />)}
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
          <svg className={styles.navConnector} width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M0 10 Q10 2 20 10" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>

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
          <svg className={styles.navConnector} width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M0 10 Q10 2 20 10" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>

          {/* You / account */}
          <button
            className={styles.navBtn}
            onClick={() => setShowYou(true)}
            aria-label="You"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M3 16a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </nav>


      {/* ── You sheet ── */}
      {showYou && (
        <>
          <div className={styles.backdrop} onClick={() => setShowYou(false)} />
          <div className={styles.youSheet}>
            <div className={styles.youHandle} />

            {/* Auth row */}
            <div className={styles.youAuthRow}>
              {user ? (
                <>
                  <div className={styles.youAvatar}>
                    {user.user_metadata?.avatar_url
                      ? <img src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" className={styles.youAvatarImg} />
                      : <span>{(user.user_metadata?.full_name ?? user.email ?? "?")[0].toUpperCase()}</span>
                    }
                  </div>
                  <div className={styles.youUserInfo}>
                    <span className={styles.youName}>{user.user_metadata?.full_name ?? "Signed in"}</span>
                    <span className={styles.youEmail}>{user.email}</span>
                  </div>
                </>
              ) : (
                <div className={styles.youSignIn}>
                  <span className={styles.youSignInLabel}>Sign in to sync your preferences</span>
                </div>
              )}
            </div>

            {/* Menu items */}
            <div className={styles.youMenu}>
              <button className={styles.youItem} onClick={() => { setShowOnboarding(true); setShowYou(false); }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.1 4.1l1.4 1.4M12.5 12.5l1.4 1.4M4.1 13.9l1.4-1.4M12.5 5.5l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                <span>Interests & sources</span>
                <svg className={styles.youChevron} width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </button>

              <Link href="/sources" className={styles.youItem} onClick={() => setShowYou(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 7h8M5 10h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                <span>Source profiles</span>
                <svg className={styles.youChevron} width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </Link>

              <Link href="/methodology" className={styles.youItem} onClick={() => setShowYou(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.3"/><path d="M9 8v5M9 6h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                <span>How we classify</span>
                <svg className={styles.youChevron} width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </Link>

              {user?.email === ADMIN_EMAIL && (
                <Link href="/admin" className={styles.youItem} onClick={() => setShowYou(false)}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 6h8M5 9h5M5 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  <span>Admin</span>
                  <svg className={styles.youChevron} width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                </Link>
              )}

              {user && (
                <button className={`${styles.youItem} ${styles.youSignOutBtn}`} onClick={() => { /* signOut handled via useAuth */ setShowYou(false); }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7 2H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3M11 13l4-4-4-4M15 9H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  <span>Sign out</span>
                </button>
              )}

              {!user && (
                <button className={`${styles.youItem} ${styles.youSignInBtn}`} onClick={() => setShowYou(false)}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 2h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3M7 13l4-4-4-4M3 9h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  <span>Sign in with Google</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
