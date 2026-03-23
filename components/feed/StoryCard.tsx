"use client";

import { useState } from "react";
import type { Article } from "@/lib/types";
import styles from "./StoryCard.module.css";

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
  position: number;
  total: number;
}

export default function StoryCard({ article, isActive, position, total }: Props) {
  const [saved, setSaved] = useState(false);
  const hasImage = !!article.image_url;
  const sourceName = article.sources?.name ?? "Unknown";
  const age = timeAgo(article.published_at ?? article.ingested_at);
  const tag = article.topic_tags?.[0];

  return (
    <article className={`${styles.card} ${isActive ? styles.active : ""} ${hasImage ? styles.hasImage : ""}`}>

      {/* Background image with overlay */}
      {hasImage && (
        <div className={styles.imageBg}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url!}
            alt=""
            className={styles.bgImg}
            loading="lazy"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.parentElement!.style.display = "none";
            }}
          />
          <div className={styles.imageOverlay} />
        </div>
      )}

      {/* Card content */}
      <div className={styles.content}>

        {/* Top meta row */}
        <div className={styles.topRow}>
          <div className={styles.metaLeft}>
            <span className={styles.source}>{sourceName}</span>
            {tag && <span className={styles.tag}>{tag}</span>}
          </div>
          <div className={styles.metaRight}>
            <span className={styles.age}>{age}</span>
            <span className={styles.counter}>{position}/{total}</span>
          </div>
        </div>

        {/* Main content area */}
        <div className={styles.body}>
          {/* Headline */}
          <h2 className={styles.headline}>{article.headline}</h2>

          {/* Summary */}
          {article.summary && (
            <p className={styles.summary}>{article.summary}</p>
          )}
        </div>

        {/* Bottom action row */}
        <div className={styles.actions}>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.readBtn}
          >
            Read full story
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1 11L11 1M11 1H5M11 1V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>

          <button
            className={`${styles.saveBtn} ${saved ? styles.saveBtnActive : ""}`}
            onClick={() => setSaved((v) => !v)}
            aria-label={saved ? "Unsave story" : "Save story"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 2h10a1 1 0 0 1 1 1v11l-6-3-6 3V3a1 1 0 0 1 1-1z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
                fill={saved ? "currentColor" : "none"}
              />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}
