"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Article, TopicId } from "@/lib/types";
import { TOPICS } from "@/lib/types";
import { usePreferences } from "@/lib/usePreferences";
import { useAuth } from "@/lib/useAuth";
import { useNudge } from "@/lib/useNudge";
import { getAffinity, topTopics } from "@/lib/affinity";
import ArticleCard from "./ArticleCard";
import SnapFeed from "./SnapFeed";
import BlotGlyph from "./BlotGlyph";
import Onboarding from "@/components/ui/Onboarding";
import RefreshBanner, { type RefreshBannerHandle } from "@/components/ui/RefreshBanner";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import styles from "./FeedClient.module.css";

const SEEN_CARDS_KEY = "nm_seen_cards";
const SEEN_CAP = 200;
const ADMIN_EMAIL = "shubhamk0473@gmail.com";

function readSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_CARDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

interface ClusterStory {
  id: string;
  cluster_id: string;
  headline: string;
  cluster_source_count: number;
  cluster_framing_insight: string | null;
  cluster_divergence_score: number | null;
  cluster_framing_groups: Array<{ outlets: string[]; headline: string; slant?: string }> | null;
  topic_tags?: string[] | null;
}

interface Props {
  initialArticles: Article[];
  topClusters?: ClusterStory[];
}

type ViewMode = "cards" | "list";

/**
 * Feed ordering: recency (50%) + multi-outlet cluster boost (25%) + topic
 * affinity (25%), with an exploration slot every 6th card — the best story
 * OUTSIDE the reader's top topics, so personalization never seals the bubble.
 * With an empty affinity map (guests, SSR) this degrades gracefully to
 * recency + cluster ordering.
 */
function orderFeed(
  articles: Article[],
  affinity: Record<string, number>,
  exploreTopics: Set<string>
): Article[] {
  const now = Date.now();
  const maxAff = Math.max(1, ...Object.values(affinity).map((v) => Math.abs(v)));

  const scored = articles.map((a) => {
    const ageH = (now - new Date(a.published_at ?? a.ingested_at).getTime()) / 3600000;
    const recency = Math.max(0, 1 - ageH / 48);
    const cluster = Math.min(1, ((a.cluster_source_count ?? 1) - 1) / 4);
    const affRaw = Math.max(0, ...(a.topic_tags ?? []).map((t) => affinity[t] ?? 0));
    const aff = affRaw / maxAff;
    return { a, score: 0.5 * recency + 0.25 * cluster + 0.25 * aff };
  });
  scored.sort((x, y) => y.score - x.score);

  if (exploreTopics.size === 0) return scored.map((s) => s.a);

  // Interleave: every 6th slot goes to the best not-yet-used story whose
  // topics avoid the reader's top interests.
  const used = new Set<string>();
  const result: Article[] = [];
  const isExploration = (a: Article) =>
    !(a.topic_tags ?? []).some((t) => exploreTopics.has(t));

  let cursor = 0;
  while (result.length < scored.length) {
    const wantExplore = (result.length + 1) % 6 === 0;
    let pick: Article | null = null;
    if (wantExplore) {
      const found = scored.find((s) => !used.has(s.a.id) && isExploration(s.a));
      if (found) pick = found.a;
    }
    if (!pick) {
      while (cursor < scored.length && used.has(scored[cursor].a.id)) cursor++;
      if (cursor >= scored.length) break;
      pick = scored[cursor].a;
    }
    used.add(pick.id);
    result.push(pick);
  }
  return result;
}

export default function FeedClient({ initialArticles, topClusters = [] }: Props) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { prefs, loaded, save } = usePreferences(user);
  const router = useRouter();
  const refreshBannerRef = useRef<RefreshBannerHandle>(null);

  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  // Affinity loads post-mount (localStorage) — SSR renders the neutral order
  const [affinity, setAffinity] = useState<Record<string, number>>({});
  const [exploreTopics, setExploreTopics] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [activeTopic, setActiveTopic] = useState<TopicId | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showYou, setShowYou] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [advanceCount, setAdvanceCount] = useState(0);
  const { nudge } = useNudge(user, initialArticles);

  // Onboarding: only decide once auth AND prefs are fully resolved — deciding
  // early treats a signed-in user as a fresh guest for a few ms (popup flash),
  // and the popup must also close itself when real prefs say onboarding is done.
  useEffect(() => {
    if (authLoading || !loaded) return;
    setShowOnboarding(!prefs.onboardingDone);
  }, [authLoading, loaded, prefs.onboardingDone]);

  // Read seen card IDs + affinity from localStorage on mount
  useEffect(() => {
    setSeenIds(readSeenIds());
    setAffinity(getAffinity());
    setExploreTopics(new Set(topTopics(3)));
  }, []);

  useEffect(() => {
    document.body.style.overflow = viewMode === "list" ? "auto" : "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, [viewMode]);

  const handleRefresh = useCallback(() => {
    setIsReloading(true);
    router.refresh();
    setTimeout(() => setIsReloading(false), 900);
  }, [router]);

  const handleSignIn = useCallback(async () => {
    await signIn();
    setShowYou(false);
  }, [signIn]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setShowYou(false);
    router.refresh();
  }, [signOut, router]);

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

    if (activeTopic) return base;

    // Surface unseen stories first; already-seen sink to the back
    const unseen = base.filter((a) => !seenIds.has(a.id));
    const seen   = base.filter((a) =>  seenIds.has(a.id));
    return [
      ...orderFeed(unseen, affinity, exploreTopics),
      ...orderFeed(seen, affinity, exploreTopics),
    ];
  }, [initialArticles, activeTopic, prefs.topics, effectiveSources, seenIds, affinity, exploreTopics]);

  const handleOnboardingDone = ({ topics, sources }: { topics: TopicId[]; sources: string[] }) => {
    save({ topics, sources, onboardingDone: true });
    setShowOnboarding(false);
  };

  const busy = isRefreshing || isReloading;
  const displayArticles = filtered.length > 0 ? filtered : initialArticles;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today   = displayArticles.filter((a) =>  a.published_at && new Date(a.published_at) >= todayStart);
  const earlier = displayArticles.filter((a) => !a.published_at || new Date(a.published_at) <  todayStart);

  return (
    <div className={`${styles.shell} ${viewMode === "list" ? styles.listShell : ""}`}>

      {showOnboarding && loaded && (
        <Onboarding sources={allSources} onDone={handleOnboardingDone} />
      )}

      {/* ── Top bar ── */}
      <header className={styles.topbar}>
        <div className={styles.wordmark}>News<span>Mirror</span></div>
        <div className={styles.topbarRight}>
          <BlotGlyph count={advanceCount} />
          <button
            className={`${styles.iconBtn} ${sourceFilterOpen ? styles.iconBtnActive : ""}`}
            onClick={() => setSourceFilterOpen((v) => !v)}
            aria-label="Filter topics and sources"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3.5h12M3.5 7h7M6 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          {viewMode === "cards" && (
            <>
              <button
                className={styles.iconBtn}
                onClick={() => setViewMode("list")}
                aria-label="Switch to list view"
              >
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
              <button
                className={styles.iconBtn}
                onClick={() => setShowYou(true)}
                aria-label="You"
              >
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M3 16a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Source dropdown ── */}
      {sourceFilterOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setSourceFilterOpen(false)} />
          <div className={styles.sourceDropdown}>
            {viewMode === "cards" && (
              <div className={styles.sheetTopics}>
                <div className={styles.sheetLabel}>Topics</div>
                <div className={styles.sheetPills}>
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
                <div className={styles.sheetLabel}>Sources</div>
              </div>
            )}
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

      {/* ── Topic pill bar — list mode only; cards mode filters live in the sheet ── */}
      {viewMode === "list" && (
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
      )}

      {/* ── Trending bar — list mode only; cards mode gives the space to stories ── */}
      {viewMode === "list" && topClusters.length > 0 && (
        <div className={styles.trendingBar}>
          <span className={styles.trendingLabel}>Trending</span>
          <div className={styles.trendingDivider} aria-hidden />
          <div className={styles.trendingScroll}>
            {topClusters.map((cluster, i) => {
              const hasDivergence = (cluster.cluster_divergence_score ?? 0) > 0.3;
              return (
                <Link
                  key={cluster.cluster_id}
                  href={`/timeline/${cluster.cluster_id}`}
                  className={styles.trendingItem}
                  prefetch
                >
                  {i > 0 && <span className={styles.trendingSep} aria-hidden>·</span>}
                  {hasDivergence && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden className={styles.trendingWave}>
                      <path d="M0.5 4h1.5L3 1.5 4.5 6.5 5 4H7.5" stroke="#d97706" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  <span className={styles.trendingHeadline}>{cluster.headline}</span>
                  <span className={styles.trendingCount}>{cluster.cluster_source_count}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

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
        <SnapFeed articles={displayArticles} user={user} nudge={nudge} onAdvance={setAdvanceCount} />
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

      {/* ── PWA install prompt ── */}
      <InstallPrompt />

      {/* ── Connected bottom nav — list mode only; cards mode is full-bleed stories ── */}
      {viewMode === "list" && (
      <nav className={styles.bottomNavWrap} aria-label="Main navigation">
        <div className={styles.bottomNav}>

          {/* Cards — nav renders only in list mode, so never active here */}
          <button
            className={styles.navBtn}
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

          {/* Curved connector */}
          <svg className={styles.navConnector} width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M0 10 Q10 2 20 10" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>

          {/* List */}
          <button
            className={`${styles.navBtn} ${styles.navBtnActive}`}
            onClick={() => setViewMode("list")}
            aria-label="List feed"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Curved connector */}
          <svg className={styles.navConnector} width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M0 10 Q10 2 20 10" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>

          {/* You */}
          <button
            className={`${styles.navBtn} ${showYou ? styles.navBtnActive : ""}`}
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
      )}

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
              <Link href="/mirror" className={styles.youItem} onClick={() => setShowYou(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2C7 3.2 4.8 2.6 3.6 4.8C2.4 7 4.2 8.2 3.6 10.6C3.3 12.4 5.4 14.2 7.2 13C8.4 12.2 8.7 12.7 9 12.7C9.3 12.7 9.6 12.2 10.8 13C12.6 14.2 14.7 12.4 14.4 10.6C13.8 8.2 15.6 7 14.4 4.8C13.2 2.6 11 3.2 9 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                <span>Your mirror</span>
                <svg className={styles.youChevron} width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </Link>

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

              {user ? (
                <button className={`${styles.youItem} ${styles.youSignOutBtn}`} onClick={handleSignOut}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7 2H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3M11 13l4-4-4-4M15 9H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  <span>Sign out</span>
                </button>
              ) : (
                <button className={`${styles.youItem} ${styles.youSignInBtn}`} onClick={handleSignIn}>
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
