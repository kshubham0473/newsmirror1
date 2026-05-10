"use client";

import { useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import type { Article } from "@/lib/types";
import { useReadingEvents } from "@/lib/useReadingEvents";
import { useArticleReaction } from "@/lib/useArticleReaction";
import styles from "./StoryCard.module.css";

// Cycle through 3 pastel card colours by position
const CARD_COLORS = ["var(--card-blush)", "var(--card-blue)", "var(--card-cream)"];

// Plain-language explanations for each framing axis
const LEAN_INFO: Record<string, { title: string; lo: string; hi: string; desc: string }> = {
  "Identity framing": {
    title: "Identity framing",
    lo: "Pluralist",
    hi: "Majoritarian",
    desc: "How does this outlet frame stories involving different communities? Pluralist coverage treats all groups equally. Majoritarian coverage centres one community's perspective above others.",
  },
  "State narrative": {
    title: "State narrative",
    lo: "Sceptical",
    hi: "Deferential",
    desc: "Does this outlet question government claims or largely accept them? Sceptical coverage seeks independent verification. Deferential coverage reproduces official positions with little pushback.",
  },
  "Economic framing": {
    title: "Economic framing",
    lo: "Welfare-focused",
    hi: "Market-focused",
    desc: "When covering economic stories, does this outlet centre people's welfare or market performance? Welfare framing highlights inequality and labour. Market framing highlights GDP, growth, and investor sentiment.",
  },
  "Institutional tone": {
    title: "Institutional tone",
    lo: "Critical",
    hi: "Deferential",
    desc: "How does this outlet treat institutions like courts, the RBI, or the Election Commission? Critical coverage questions their decisions. Deferential coverage treats institutional authority as legitimate and final.",
  },
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface FramingGroup {
  outlets: string[];
  headline: string;
  slant?: string;
}

// Extend Article with framing fields injected by feed/page.tsx
type ArticleWithFraming = Article & {
  cluster_framing_insight?: string | null;
  cluster_divergence_score?: number | null;
  cluster_framing_groups?: FramingGroup[] | null;
};

// Amber/teal left-border colours cycling through framing groups
const FRAMING_GROUP_COLORS = ["#d97706", "#0d9488", "#7c3aed", "#be185d"];

interface Props {
  article: ArticleWithFraming;
  isActive: boolean;
  position: number;
  total: number;
  isDragging?: boolean;
  user?: User | null;
}

function getLean(article: Article): string | null {
  const { identity_score, state_trust_score, economic_score, institution_score } = article;

  const axes = [
    { label: "Identity framing",   value: identity_score },
    { label: "State narrative",    value: state_trust_score },
    { label: "Economic framing",   value: economic_score },
    { label: "Institutional tone", value: institution_score },
  ];

  const scored = axes
    .filter((a) => typeof a.value === "number")
    .map((a) => ({ ...a, diff: Math.abs((a.value as number) - 0.5) }))
    .sort((a, b) => b.diff - a.diff);

  if (!scored.length || scored[0].diff < 0.12) return null;
  return scored[0].label;
}

export default function StoryCard({ article, position, total, user = null }: Props) {
  const [imgFailed, setImgFailed]     = useState(false);
  const [leanOpen, setLeanOpen]       = useState(false);
  const [framingOpen, setFramingOpen] = useState(false);
  const { trackRead }                 = useReadingEvents(user);
  const { reaction, react }           = useArticleReaction(user, article.id);
  const hasImage    = !!article.image_url && !imgFailed;
  const sourceName  = article.sources?.name ?? "Unknown";
  const sourceInit  = sourceName.slice(0, 2).toUpperCase();
  const age         = timeAgo(article.published_at ?? article.ingested_at);
  const tag         = article.topic_tags?.[0];
  const lean        = getLean(article);
  const leanInfo    = lean ? LEAN_INFO[lean] : null;
  const sourceCount = article.cluster_source_count ?? null;
  const cardColor   = CARD_COLORS[(position - 1) % 3];

  const framingInsight   = article.cluster_framing_insight ?? null;
  const divergenceScore  = article.cluster_divergence_score ?? 0;
  const framingGroups    = article.cluster_framing_groups ?? [];
  const hasFramingPanel  = !!framingInsight && divergenceScore > 0.3 && framingGroups.length >= 2;
  const divergencePct    = Math.round(divergenceScore * 100);

  return (
    <article className={`${styles.card} ${!hasImage ? styles.cardNoImage : ""}`} style={{ background: cardColor }}>

      {/* ── Top strip: lean pill left · framing badge + tag right ── */}
      <div className={styles.strip}>
        <div className={styles.stripLeft}>
          {lean && (
            <button
              className={styles.leanPill}
              onClick={(e) => { e.stopPropagation(); setLeanOpen(true); }}
              aria-label={`What is ${lean}?`}
            >
              <span className={styles.leanDot} aria-hidden />
              {lean}
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden className={styles.leanInfo}>
                <circle cx="4.5" cy="4.5" r="4" stroke="currentColor" strokeWidth="1.1" opacity="0.5"/>
                <path d="M4.5 4v2.5M4.5 3h.01" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
        <div className={styles.stripRight}>
          {hasFramingPanel && (
            <button
              className={styles.framingBadge}
              onClick={(e) => { e.stopPropagation(); setFramingOpen((v) => !v); }}
              aria-label="See how outlets framed this differently"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
                <path d="M1 4.5h2L3.5 1 5 8l.5-3.5H8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Framing gap
            </button>
          )}
          {tag && <span className={styles.tagChip}>{tag}</span>}
        </div>
      </div>

      {/* ── Image zone ── */}
      <div className={styles.imageZone}>
        {hasImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={article.image_url!}
            alt=""
            className={styles.image}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : null}
      </div>

      {/* ── Text zone ── */}
      <div className={styles.textZone}>
        {/* Source row */}
        <div className={styles.sourceRow}>
          <span className={styles.sourceAvatar}>{sourceInit}</span>
          <span className={styles.sourceName}>{sourceName}</span>
          <span className={styles.age}>{age}</span>
        </div>

        {/* Headline */}
        <h2 className={styles.headline}>{article.headline}</h2>

        {/* Summary */}
        {article.summary && (
          <p className={styles.summary}>{article.summary}</p>
        )}

        {/* ── Framing divergence expandable section ── */}
        {hasFramingPanel && (
          <div className={styles.framingSection}>
            <button
              className={styles.framingToggle}
              onClick={(e) => { e.stopPropagation(); setFramingOpen((v) => !v); }}
              aria-expanded={framingOpen}
            >
              <span className={styles.framingToggleLeft}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M1 5.5h2.5L4 2 5.5 9 6 6H10" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className={styles.framingToggleLabel}>Outlets framed this differently</span>
              </span>
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
                className={`${styles.framingChevron} ${framingOpen ? styles.framingChevronOpen : ""}`}
              >
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {framingOpen && (
              <div className={styles.framingPanel}>
                <p className={styles.framingInsight}>{framingInsight}</p>

                {/* Framing groups — coloured left borders */}
                <div className={styles.framingGroups}>
                  {framingGroups.map((group, i) => (
                    <div
                      key={i}
                      className={styles.framingGroup}
                      style={{ borderLeftColor: FRAMING_GROUP_COLORS[i % FRAMING_GROUP_COLORS.length] }}
                    >
                      <div className={styles.framingGroupOutlets}>
                        {group.outlets.join(" · ")}
                      </div>
                      <p className={styles.framingGroupHeadline}>{group.headline}</p>
                      {group.slant && (
                        <span className={styles.framingGroupSlant}>{group.slant}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Divergence bar */}
                <div className={styles.framingDivergenceRow}>
                  <span className={styles.framingDivergenceLabel}>Divergence</span>
                  <div className={styles.framingDivergenceTrack}>
                    <div
                      className={styles.framingDivergenceFill}
                      style={{ width: `${divergencePct}%` }}
                    />
                  </div>
                  <span className={styles.framingDivergencePct}>{divergencePct}%</span>
                </div>

                {article.cluster_id && (
                  <Link
                    href={`/timeline/${article.cluster_id}`}
                    className={styles.framingTimelineLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Full timeline →
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          {sourceCount && sourceCount >= 2 && article.cluster_id ? (
            <Link
              href={`/timeline/${article.cluster_id}`}
              className={`${styles.sourcesPill} ${sourceCount >= 5 ? styles.sourcesPillHot : ""}`}
              onClick={(e) => e.stopPropagation()}
              prefetch
            >
              <span className={styles.sourceDots}>
                {Array.from({ length: Math.min(sourceCount, 3) }).map((_, i) => (
                  <span key={i} className={styles.sourceDot} />
                ))}
              </span>
              <span className={styles.sourcesLabel}>
                {sourceCount >= 5 ? `${sourceCount} outlets · See timeline` : `${sourceCount} sources covered this`}
              </span>
            </Link>
          ) : (
            <span className={styles.singleSource}>Single source</span>
          )}

          <div className={styles.footerRight}>
            {user && (
              <div className={styles.reactions}>
                <button
                  className={`${styles.reactionBtn} ${reaction === 1 ? styles.reactionUp : ""}`}
                  onClick={(e) => { e.stopPropagation(); react(1); }}
                  aria-label="Helpful"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M5 6V3a1 1 0 0 1 1-1l3 4v5H4.5a1 1 0 0 1-1-.8L3 7.5a1 1 0 0 1 1-1.5H5zM9 11V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  className={`${styles.reactionBtn} ${reaction === -1 ? styles.reactionDown : ""}`}
                  onClick={(e) => { e.stopPropagation(); react(-1); }}
                  aria-label="Not helpful"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 8v3a1 1 0 0 1-1 1L5 8V3h4.5a1 1 0 0 1 1 .8L11 6.5a1 1 0 0 1-1 1.5H9zM5 3v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            )}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.readBtn}
              onClick={(e) => { e.stopPropagation(); trackRead({ articleId: article.id, sourceId: article.source_id }); }}
            >
              Read ↗
            </a>
          </div>
        </div>
      </div>

      {/* ── Lean tooltip sheet ── */}
      {leanOpen && leanInfo && (
        <>
          <div
            className={styles.tooltipBackdrop}
            onClick={(e) => { e.stopPropagation(); setLeanOpen(false); }}
          />
          <div className={styles.tooltipSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.tooltipHandle} />
            <div className={styles.tooltipHeader}>
              <span className={styles.tooltipDot} aria-hidden />
              <span className={styles.tooltipTitle}>{leanInfo.title}</span>
            </div>
            <div className={styles.tooltipSpectrum}>
              <span className={styles.spectrumLo}>{leanInfo.lo}</span>
              <div className={styles.spectrumTrack}>
                <div className={styles.spectrumLine} />
                <div className={styles.spectrumArrowLeft}>←</div>
                <div className={styles.spectrumArrowRight}>→</div>
              </div>
              <span className={styles.spectrumHi}>{leanInfo.hi}</span>
            </div>
            <p className={styles.tooltipDesc}>{leanInfo.desc}</p>
            <Link
              href="/methodology"
              className={styles.tooltipLink}
              onClick={(e) => e.stopPropagation()}
            >
              Read our full methodology →
            </Link>
          </div>
        </>
      )}

    </article>
  );
}
