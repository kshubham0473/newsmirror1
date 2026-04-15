"use client";

import { useState } from "react";
import Link from "next/link";
import type { Article } from "@/lib/types";
import styles from "./ArticleCard.module.css";

const ACCENT_COLORS = ["var(--card-blush)", "var(--card-blue)", "var(--card-cream)"];

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  article: Article;
  index?: number;
}

export default function ArticleCard({ article, index = 0 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sourceName = article.sources?.name ?? "Unknown";
  const age = timeAgo(article.published_at ?? article.ingested_at);
  const tag = article.topic_tags?.[0];
  const accentColor = ACCENT_COLORS[index % 3];
  const sourceCount = article.cluster_source_count ?? null;

  return (
    <article className={styles.card}>
      {/* Left accent bar */}
      <div className={styles.accent} style={{ background: accentColor }} aria-hidden />

      <div className={styles.body}>
        {/* Meta row */}
        <div className={styles.meta}>
          <span className={styles.source}>{sourceName}</span>
          <span className={styles.dot} aria-hidden>·</span>
          <span className={styles.age}>{age}</span>
          {tag && (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <span className={styles.tag}>{tag}</span>
            </>
          )}
          {sourceCount && sourceCount >= 2 && article.cluster_id && (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <Link
                href={`/story/${article.cluster_id}`}
                className={styles.sourcesPill}
                style={{ color: accentColor }}
              >
                {sourceCount} sources
              </Link>
            </>
          )}
        </div>

        {/* Headline */}
        <h2 className={styles.headline}>{article.headline}</h2>

        {/* Summary */}
        {article.summary && (
          <p className={`${styles.summary} ${expanded ? styles.summaryExpanded : ""}`}>
            {article.summary}
          </p>
        )}

        {/* Actions */}
        <div className={styles.actions}>
          {article.summary && (
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "Less" : "Summary"}
            </button>
          )}
          {sourceCount && sourceCount >= 2 && article.cluster_id && (
            <Link href={`/story/${article.cluster_id}`} className={styles.compareBtn}>
              Compare sources
            </Link>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.readBtn}
          >
            Read ↗
          </a>
        </div>
      </div>
    </article>
  );
}
