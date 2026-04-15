"use client";

import { useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import type { Article } from "@/lib/types";
import { useReadingEvents } from "@/lib/useReadingEvents";
import { useArticleReaction } from "@/lib/useArticleReaction";
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
  user?: User | null;
}

export default function ArticleCard({ article, index = 0, user = null }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { trackRead } = useReadingEvents(user);
  const { reaction, react } = useArticleReaction(user, article.id);
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
          {user && (
            <div className={styles.reactions}>
              <button
                className={`${styles.reactionBtn} ${reaction === 1 ? styles.reactionUp : ""}`}
                onClick={() => react(1)}
                aria-label="Helpful"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M5 6V3a1 1 0 0 1 1-1l3 4v5H4.5a1 1 0 0 1-1-.8L3 7.5a1 1 0 0 1 1-1.5H5zM9 11V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                className={`${styles.reactionBtn} ${reaction === -1 ? styles.reactionDown : ""}`}
                onClick={() => react(-1)}
                aria-label="Not helpful"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
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
            onClick={() => trackRead({ articleId: article.id, sourceId: article.source_id })}
          >
            Read ↗
          </a>
        </div>
      </div>
    </article>
  );
}
