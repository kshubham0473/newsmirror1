"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Article, TopicId } from "@/lib/types";
import { TOPICS } from "@/lib/types";
import { usePreferences } from "@/lib/usePreferences";
import { useAuth } from "@/lib/useAuth";
import { useNudge } from "@/lib/useNudge";
import { getAffinity, topTopics, entityAffinity } from "@/lib/affinity";
import { getFollows, normEntity } from "@/lib/follows";
import { beginVisit } from "@/lib/lastVisit";
import { decodeEntities } from "@/lib/decodeEntities";
import type { DeltaItem } from "./DeltaCard";
import SnapFeed from "./SnapFeed";
import BlotGlyph from "./BlotGlyph";
import type { FeedThread } from "./ThreadFeedCard";
import Onboarding from "@/components/ui/Onboarding";
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
  topThread?: FeedThread | null;
  threadsStrip?: FeedThread[];
  /** Latest "what changed" beat per cluster_id (from cluster_beats) */
  beats?: Record<string, string>;
}

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
  exploreTopics: Set<string>,
  follows: Set<string>
): Article[] {
  const now = Date.now();
  const maxAff = Math.max(1, ...Object.values(affinity).map((v) => Math.abs(v)));

  const scored = articles.map((a) => {
    const ageH = (now - new Date(a.published_at ?? a.ingested_at).getTime()) / 3600000;
    const recency = Math.max(0, 1 - ageH / 30);
    const cluster = Math.min(1, ((a.cluster_source_count ?? 1) - 1) / 4);
    const topicAff = Math.max(0, ...(a.topic_tags ?? []).map((t) => affinity[t] ?? 0)) / maxAff;
    // Entity affinity: fine-grained interest (a saga, a club, a person) —
    // weighted above coarse topics when present
    const entAff = Math.min(1, (1.25 * entityAffinity(a.key_entities, affinity)) / maxAff);
    const aff = Math.max(topicAff, entAff);
    const followed = (a.key_entities ?? []).some((e) => follows.has(normEntity(e)));
    // Freshness hard-buckets: nothing >12h old outranks the last 6h — UNLESS
    // the reader explicitly follows the story (follows escape the buckets).
    const bucket = followed ? 0 : ageH < 6 ? 0 : ageH < 12 ? 1 : 2;
    return { a, bucket, score: 0.6 * recency + 0.2 * cluster + 0.2 * aff + (followed ? 0.35 : 0) };
  });
  scored.sort((x, y) => x.bucket - y.bucket || y.score - x.score);

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

export default function FeedClient({ initialArticles, topClusters = [], topThread = null, threadsStrip = [], beats = {} }: Props) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { prefs, loaded, save } = usePreferences(user);
  const router = useRouter();

  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  // Affinity loads post-mount (localStorage) — SSR renders the neutral order
  const [affinity, setAffinity] = useState<Record<string, number>>({});
  const [exploreTopics, setExploreTopics] = useState<Set<string>>(new Set());
  const [activeTopic, setActiveTopic] = useState<TopicId | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showYou, setShowYou] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [advanceCount, setAdvanceCount] = useState(0);
  const retriedRef = useRef(false);
  const [follows, setFollows] = useState<Set<string>>(new Set());
  const [deltaCutoff, setDeltaCutoff] = useState<number | null>(null);
  const { nudge } = useNudge(user, initialArticles);

  // Onboarding: only decide once auth AND prefs are fully resolved — deciding
  // early treats a signed-in user as a fresh guest for a few ms (popup flash),
  // and the popup must also close itself when real prefs say onboarding is done.
  useEffect(() => {
    if (authLoading || !loaded) return;
    setShowOnboarding(!prefs.onboardingDone);
  }, [authLoading, loaded, prefs.onboardingDone]);

  // Read seen card IDs + affinity + follows from localStorage on mount
  useEffect(() => {
    setSeenIds(readSeenIds());
    setAffinity(getAffinity());
    setExploreTopics(new Set(topTopics(3)));
    setFollows(new Set(getFollows()));
    setDeltaCutoff(beginVisit());
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, []);

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
      ...orderFeed(unseen, affinity, exploreTopics, follows),
      ...orderFeed(seen, affinity, exploreTopics, follows),
    ];
  }, [initialArticles, activeTopic, prefs.topics, effectiveSources, seenIds, affinity, exploreTopics, follows]);

  // ── Catch-up delta: biggest developments since the reader left ──
  const { deltaItems, awaySince } = useMemo(() => {
    if (!deltaCutoff) return { deltaItems: [] as DeltaItem[], awaySince: "" };
    const fresh = initialArticles.filter(
      (a) => new Date(a.ingested_at).getTime() > deltaCutoff
    );
    // Group by cluster (standalone articles form their own group)
    const groups = new Map<string, Article[]>();
    for (const a of fresh) {
      const k = a.cluster_id ?? `a:${a.id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(a);
    }
    const now = Date.now();
    const ranked = Array.from(groups.entries()).map(([k, arts]) => {
      const rep = arts.reduce((best, x) =>
        new Date(x.published_at ?? x.ingested_at).getTime() >
        new Date(best.published_at ?? best.ingested_at).getTime() ? x : best);
      const followed = arts.some((x) => (x.key_entities ?? []).some((e) => follows.has(normEntity(e))));
      const entAff = Math.max(...arts.map((x) => entityAffinity(x.key_entities, affinity)));
      const velocity = Math.min(1, arts.length / 4);
      const ageH = (now - new Date(rep.published_at ?? rep.ingested_at).getTime()) / 3600000;
      const freshness = Math.max(0, 1 - ageH / 12);
      const srcCount = rep.cluster_source_count ?? 1;
      const score = (followed ? 2 : 0) + (entAff > 0 ? 0.6 : 0) + velocity + freshness + Math.min(1, (srcCount - 1) / 4);
      return { k, rep, followed, srcCount, score, ageH };
    })
    // A delta item must have a reason to exist: followed, known interest, or broad coverage
    .filter((g) => g.followed || g.score >= 1.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

    const items: DeltaItem[] = ranked.map((g) => ({
      line: (g.rep.cluster_id && beats[g.rep.cluster_id]) || g.rep.headline,
      cluster_id: g.rep.cluster_id ?? null,
      article_url: g.rep.url,
      source_count: g.srcCount,
      followed: g.followed,
      age: g.ageH < 1 ? "just now" : `${Math.round(g.ageH)}h ago`,
    }));

    const d = new Date(deltaCutoff);
    const sameDay = new Date().toDateString() === d.toDateString();
    const label = sameDay
      ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      : d.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
    return { deltaItems: items, awaySince: label };
  }, [initialArticles, deltaCutoff, follows, affinity, beats]);

  const handleOnboardingDone = ({ topics, sources }: { topics: TopicId[]; sources: string[] }) => {
    save({ topics, sources, onboardingDone: true });
    setShowOnboarding(false);
  };

  const busy = isReloading;
  const displayArticles = filtered.length > 0 ? filtered : initialArticles;


  return (
    <div className={styles.shell}>

      {showOnboarding && loaded && (
        <Onboarding sources={allSources} onDone={handleOnboardingDone} />
      )}

      {/* ── Top bar ── */}
      <header className={styles.topbar}>
        <div className={styles.wordmark}>News<span>Mirror</span></div>
        <div className={styles.topbarRight}>
          <BlotGlyph count={advanceCount} />
          <Link href="/threads" className={styles.iconBtn} aria-label="Developing threads" prefetch>
            {/* time-spine glyph: a line of story-beats */}
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
              <path d="M9 2v14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <circle cx="9" cy="4.5" r="2" fill="currentColor"/>
              <circle cx="9" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="9" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
          </Link>
          <button
            className={`${styles.iconBtn} ${sourceFilterOpen ? styles.iconBtnActive : ""}`}
            onClick={() => setSourceFilterOpen((v) => !v)}
            aria-label="Filter topics and sources"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3.5h12M3.5 7h7M6 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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
        </div>
      </header>

      {/* ── Source dropdown ── */}
      {sourceFilterOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setSourceFilterOpen(false)} />
          <div className={styles.sourceDropdown}>
            {(
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

      {/* ── Developing strip — Threads at reading-flow level (cards mode) ── */}
      {(threadsStrip.length > 0 || topClusters.length > 0) && (
        <div className={styles.devStrip}>
          <Link href="/threads" className={styles.devStripLabel} prefetch>
            <span className={styles.devDot} />Now
          </Link>
          <div className={styles.devStripScroll}>
            {/* Breaking multi-outlet stories first — trending the moment they cluster */}
            {topClusters.slice(0, 3).map((c) => (
              <Link key={c.cluster_id} href={`/timeline/${c.cluster_id}`} className={`${styles.devChip} ${styles.hotChip}`} prefetch>
                {decodeEntities(c.headline).length > 42 ? `${decodeEntities(c.headline).slice(0, 42)}…` : decodeEntities(c.headline)}
                <span className={styles.devChipDay}>{c.cluster_source_count}⚡</span>
              </Link>
            ))}
            {threadsStrip.map((t) => (
              <Link key={t.id} href={`/threads/${t.id}`} className={styles.devChip} prefetch>
                {t.title ?? t.anchor_entity}
                <span className={styles.devChipDay}>d{Math.max(1, Math.round((new Date(t.last_article_at ?? Date.now()).getTime() - new Date(t.first_seen ?? Date.now()).getTime()) / 864e5) + 1)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {busy && (
        <div className={styles.progressBar} aria-hidden>
          <div className={styles.progressFill} />
        </div>
      )}

      {/* ── Content ── */}
      {busy ? (
        <div className={styles.skeleton} aria-hidden>
          <div className={styles.skelCard} />
        </div>
      ) : displayArticles.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Couldn&rsquo;t load stories</p>
          <p className={styles.emptyHint}>Weak connection, most likely. Fresh news is waiting on the other side.</p>
          <button
            className={styles.emptyRetry}
            onClick={() => {
              // First tap: soft refresh. If that served the same cached empty
              // page, second tap: full reload past the service worker.
              if (retriedRef.current) { window.location.reload(); return; }
              retriedRef.current = true;
              handleRefresh();
            }}
          >
            ↻ Try again
          </button>
        </div>
      ) : (
        <SnapFeed
          articles={displayArticles}
          user={user}
          nudge={nudge}
          thread={topThread}
          onAdvance={setAdvanceCount}
          onRefresh={handleRefresh}
          deltaItems={deltaItems}
          awaySince={awaySince}
        />
      )}

      {/* ── PWA install prompt ── */}
      <InstallPrompt />

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
