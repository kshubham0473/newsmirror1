"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import type { Article } from "@/lib/types";
import { useReadingEvents } from "@/lib/useReadingEvents";
import { useArticleReaction } from "@/lib/useArticleReaction";
import { decodeEntities } from "@/lib/decodeEntities";
import { recordSignal, SIGNAL } from "@/lib/affinity";
import FollowButton from "./FollowButton";
import styles from "./FlipCard.module.css";

// Pastel front faces cycle by position — same palette as the old stack
const PASTELS = [styles.pBlush, styles.pBlue, styles.pCream];

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

interface FramingGroup {
  outlets: string[];
  headline: string;
  slant?: string;
}

export type ArticleWithFraming = Article & {
  cluster_framing_insight?: string | null;
  cluster_divergence_score?: number | null;
  cluster_framing_groups?: FramingGroup[] | null;
  cluster_peers?: { source: string; headline: string }[] | null;
};

interface Props {
  article: ArticleWithFraming;
  position: number;
  user?: User | null;
}

/** Average available axis scores → 0..1 position on the perspective spectrum.
 *  Confidence gate: political colour needs ≥2 scored axes — one axis alone
 *  isn't enough signal to hang saffron or teal on. */
function spectrumPosition(a: Article): number | null {
  const vals = [a.identity_score, a.state_trust_score, a.economic_score, a.institution_score]
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (vals.length < 2) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function spectrumColor(pos: number): string {
  if (pos < 0.4) return "var(--spec-cool)";
  if (pos > 0.6) return "var(--spec-warm)";
  return "var(--spec-mid)";
}

export default function FlipCard({ article, position, user = null }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const { trackRead } = useReadingEvents(user);
  const { reaction, react } = useArticleReaction(user, article.id);

  const doFlip = (next: boolean) => {
    setFlipped(next);
    if (next) recordSignal(article.topic_tags, SIGNAL.flip, article.key_entities);
  };
  const doReact = (value: 1 | -1) => {
    react(value);
    recordSignal(article.topic_tags, value === 1 ? SIGNAL.reactUp : SIGNAL.reactDown, article.key_entities);
  };
  const doOpen = () => {
    trackRead({ articleId: article.id, sourceId: article.source_id });
    recordSignal(article.topic_tags, SIGNAL.open, article.key_entities);
  };

  const sourceName = article.sources?.name ?? "Unknown";
  const age = timeAgo(article.published_at ?? article.ingested_at);
  const tag = article.topic_tags?.[0];
  const hasImage = !!article.image_url && !imgFailed;
  const pastel = PASTELS[(position - 1) % PASTELS.length];

  const insight = article.cluster_framing_insight ?? null;
  const divergence = article.cluster_divergence_score ?? 0;
  const groups = article.cluster_framing_groups ?? [];
  const peers = article.cluster_peers ?? [];
  const sourceCount = article.cluster_source_count ?? 0;
  // Rich flip: LLM framing analysis exists. Basic flip: we always have the
  // other outlets' headlines for multi-outlet stories — the flip never dies.
  const hasInsight = !!insight && divergence > 0.3 && groups.length >= 2;
  const hasFlip = hasInsight || peers.length >= 1;
  const divergencePct = Math.round(divergence * 100);
  const isHot = hasInsight && divergence >= 0.6;

  const pos = spectrumPosition(article);

  // Swipe left/right = flip — the physical gesture for "the other side"
  const touchRef = useRef({ x: 0, y: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!hasFlip) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    if (Math.abs(dx) > 64 && Math.abs(dy) < 48) doFlip(!flipped);
  };

  // Ambient framing tint: only when confidently away from centre — a wrong
  // political colour costs more trust than the feature earns.
  const ambient = pos !== null && Math.abs(pos - 0.5) >= 0.15 ? spectrumColor(pos) : null;

  const card = (
    <div
      className={`${styles.fcard} ${flipped ? styles.flipped : ""} ${hasFlip ? styles.canFlip : ""}`}
      style={{
        ["--div" as string]: `${divergencePct}%`,
        ...(ambient ? { ["--amb" as string]: ambient } : {}),
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >

      {/* ── FRONT ── */}
      <div className={`${styles.face} ${styles.front} ${pastel}`}>
        {hasImage && (
          <div className={styles.fImg}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={article.image_url!} alt="" loading="lazy" onError={() => setImgFailed(true)} />
            <span className={styles.fKick}>
              {tag ?? "News"}{sourceCount >= 2 ? ` · ${sourceCount} outlets` : ""}
            </span>
          </div>
        )}

        <div className={styles.fBody}>
          <div className={`${styles.fMeta} ${styles.rev}`}>
            <b>{sourceName}</b><span>·</span><span>{age}</span>
            {!hasImage && tag && <span className={styles.tagChip}>{tag}</span>}
            {hasFlip && (
              <button className={styles.sidesChip} onClick={() => doFlip(true)} aria-label="See how other outlets framed this">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6a4 4 0 0 1 7-2.5M10 6a4 4 0 0 1-7 2.5M9 1v2.5H6.5M3 11V8.5H5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                2 sides
              </button>
            )}
            {pos !== null && (
              <span
                className={styles.tick}
                style={hasFlip ? undefined : { marginLeft: "auto" }}
                title="Where this coverage sits on the perspective spectrum"
              >
                <span className={styles.tickRail}><i style={{ left: `${pos * 100}%`, background: spectrumColor(pos) }} /></span>
              </span>
            )}
          </div>

          <h2 className={`${styles.headline} ${styles.rev}`}>{decodeEntities(article.headline)}</h2>

          {article.summary && (
            <p className={`${styles.summary} ${styles.rev}`}>{decodeEntities(article.summary)}</p>
          )}
        </div>

        <div className={styles.fFoot}>
          {user ? (
            <div className={styles.reacts}>
              <button
                className={`${styles.reactBtn} ${reaction === 1 ? styles.reactUp : ""}`}
                onClick={() => doReact(1)} aria-label="Helpful"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 6V3a1 1 0 0 1 1-1l3 4v5H4.5a1 1 0 0 1-1-.8L3 7.5a1 1 0 0 1 1-1.5H5zM9 11V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button
                className={`${styles.reactBtn} ${reaction === -1 ? styles.reactDown : ""}`}
                onClick={() => doReact(-1)} aria-label="Not helpful"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 8v3a1 1 0 0 1-1 1L5 8V3h4.5a1 1 0 0 1 1 .8L11 6.5a1 1 0 0 1-1 1.5H9zM5 3v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          ) : <span />}
          <a
            href={article.url} target="_blank" rel="noopener noreferrer" className={styles.readBtn}
            onClick={doOpen}
          >
            Read full ↗
          </a>
        </div>

      </div>

      {/* ── BACK ── */}
      {hasFlip && (
        <div className={`${styles.face} ${styles.back}`}>
          <div className={styles.bHead}>
            <div className={styles.bKick}>◑ The other side</div>
            {hasInsight ? (
              <>
                <h3 className={styles.bTitle}>Same story, <em>different frames</em></h3>
                <p className={styles.bInsight}>{insight}</p>
              </>
            ) : (
              <h3 className={styles.bTitle}>How others <em>headlined it</em></h3>
            )}
          </div>

          <div className={styles.bFrames}>
            {hasInsight
              ? groups.map((g, i) => (
                  <div key={i} className={`${styles.bFrame} ${i % 2 === 0 ? styles.bWarm : styles.bCool}`}>
                    <div className={styles.bWho}>
                      {g.outlets.join(" · ")}{g.slant ? ` · ${g.slant}` : ""}
                    </div>
                    <p className={styles.bHl}>&ldquo;{g.headline}&rdquo;</p>
                  </div>
                ))
              : peers.map((p, i) => (
                  <div key={i} className={`${styles.bFrame} ${i % 2 === 0 ? styles.bWarm : styles.bCool}`}>
                    <div className={styles.bWho}>{p.source}</div>
                    <p className={styles.bHl}>&ldquo;{decodeEntities(p.headline)}&rdquo;</p>
                  </div>
                ))}
          </div>

          {hasInsight && (
            <div className={styles.bMeter}>
              <div className={styles.bMeterLbl}>
                <span>Framing divergence</span>
                <b>{divergence >= 0.6 ? "High" : "Moderate"} · {divergencePct}%</b>
              </div>
              <div className={styles.bTrack}><div className={styles.bFill} /></div>
            </div>
          )}

          <div className={styles.bFoot}>
            <button className={styles.unflip} onClick={() => doFlip(false)}>↺ Back to story</button>
            <FollowButton entities={article.key_entities} topics={article.topic_tags} compact />
            {article.cluster_id && (
              <Link href={`/timeline/${article.cluster_id}`} className={styles.tlBtn} prefetch>
                Full timeline →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Multi-outlet stories render as a visible STACK — sheets peeking out behind
  // the card make "there are other versions of this story" physical, not hinted.
  const stacked = hasFlip ? (
    <div className={styles.stackWrap} data-count={Math.min(sourceCount, 4)}>
      {card}
    </div>
  ) : card;

  return isHot ? (
    <div className={styles.hotRing}>
      <span className={styles.hotLabel}>⚡ Framing gap</span>
      {stacked}
    </div>
  ) : stacked;
}
