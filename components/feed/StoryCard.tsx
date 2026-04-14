"use client";

import { useState } from "react";
import Link from "next/link";
import type { Article } from "@/lib/types";
import styles from "./StoryCard.module.css";

// Cycle through 3 pastel card colours by position
const CARD_COLORS = ["var(--card-blush)", "var(--card-blue)", "var(--card-cream)"];

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

interface Props {
  article: Article;
  isActive: boolean;
  position: number;   // 1-based, used for colour cycling
  total: number;
  isDragging?: boolean;
}

function getLean(article: Article): string | null {
  const { identity_score, state_trust_score, economic_score, institution_score } = article;

  const axes = [
    { label: "Identity framing",    value: identity_score },
    { label: "State narrative",     value: state_trust_score },
    { label: "Economic framing",    value: economic_score },
    { label: "Institutional tone",  value: institution_score },
  ];

  const scored = axes
    .filter((a) => typeof a.value === "number")
    .map((a) => ({ ...a, diff: Math.abs((a.value as number) - 0.5) }))
    .sort((a, b) => b.diff - a.diff);

  if (!scored.length || scored[0].diff < 0.12) return null;
  return scored[0].label;
}

export default function StoryCard({ article, position, total }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!article.image_url && !imgFailed;
  const sourceName = article.sources?.name ?? "Unknown";
  const sourceInit = sourceName.slice(0, 2).toUpperCase();
  const age = timeAgo(article.published_at ?? article.ingested_at);
  const tag = article.topic_tags?.[0];
  const lean = getLean(article);
  const sourceCount = article.cluster_source_count ?? null;
  const cardColor = CARD_COLORS[(position - 1) % 3];

  return (
    <article className={styles.card} style={{ background: cardColor }}>

      {/* ── Top strip: lean pill left · tag + counter right ── */}
      <div className={styles.strip}>
        <div className={styles.stripLeft}>
          {lean ? (
            <span className={styles.leanPill}>
              <span className={styles.leanDot} aria-hidden />
              {lean}
            </span>
          ) : (
            <span className={styles.neutralLabel}>Neutral framing</span>
          )}
        </div>
        <div className={styles.stripRight}>
          {tag && <span className={styles.tagChip}>{tag}</span>}
          <span className={styles.counter}>{position}/{total}</span>
        </div>
      </div>

      {/* ── Image zone: 40% ── */}
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
        ) : (
          <div className={styles.imagePlaceholder} />
        )}
      </div>

      {/* ── Text zone: 50% ── */}
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

        {/* Footer: sources pill left · read btn right */}
        <div className={styles.footer}>
          {sourceCount && sourceCount >= 2 && article.cluster_id ? (
            <Link
              href={`/story/${article.cluster_id}`}
              className={styles.sourcesPill}
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.sourceDots}>
                {Array.from({ length: Math.min(sourceCount, 3) }).map((_, i) => (
                  <span key={i} className={styles.sourceDot} />
                ))}
              </span>
              <span className={styles.sourcesLabel}>{sourceCount} sources covered this</span>
            </Link>
          ) : (
            <span className={styles.singleSource}>Single source</span>
          )}

          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.readBtn}
            onClick={(e) => e.stopPropagation()}
          >
            Read ↗
          </a>
        </div>
      </div>

    </article>
  );
}
