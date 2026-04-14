"use client";

import { useState } from "react";
import Link from "next/link";
import type { Article } from "@/lib/types";
import styles from "./ArticleCard.module.css";

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
  featured?: boolean;
}

export default function ArticleCard({ article, featured = false }: Props) {
  const [expanded, setExpanded] = useState(false);

  const sourceName = article.sources?.name ?? "Unknown";
  const age = timeAgo(article.published_at ?? article.ingested_at);
  const sourceCount = article.cluster_source_count ?? null;

  return (
    <article
      className={`${styles.card} ${featured ? styles.featured : ""} ${expanded ? styles.expanded : ""}`}
    >
      {featured && article.image_url && (
        <div className={styles.imageWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url}
            alt=""
            className={styles.image}
            loading="lazy"
            onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
          />
        </div>
      )}

      <div className={styles.body}>
        {/* Meta row */}
        <div className={styles.meta}>
          <span className={styles.source}>{sourceName}</span>
          <span className={styles.dot} aria-hidden>·</span>
          <span className={styles.age}>{age}</span>
          {article.topic_tags?.length > 0 && (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <span className={styles.tag}>{article.topic_tags[0]}</span>
            </>
          )}
          {sourceCount && sourceCount >= 2 && article.cluster_id && (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <Link href={`/story/${article.cluster_id}`} className={styles.sourcesPill}>
                {sourceCount} sources
              </Link>
            </>
          )}
        </div>

        <h2 className={featured ? styles.headlineFeatured : styles.headline}>
          {article.headline}
        </h2>

        {article.summary && (
          <p className={`${styles.summary} ${expanded ? styles.summaryExpanded : ""}`}>
            {article.summary}
          </p>
        )}

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
          {article.cluster_id && sourceCount && sourceCount >= 2 && (
            <Link href={`/story/${article.cluster_id}`} className={styles.compareBtn}>
              Compare {sourceCount} sources
            </Link>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.readBtn}
          >
            Read full story
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
              <path d="M1 10L10 1M10 1H4M10 1V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </article>
  );
}


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
  featured?: boolean;
}

export default function ArticleCard({ article, featured = false }: Props) {
  const [expanded, setExpanded] = useState(false);

  const sourceName = article.sources?.name ?? "Unknown";
  const age = timeAgo(article.published_at ?? article.ingested_at);

  return (
    <article
      className={`${styles.card} ${featured ? styles.featured : ""} ${expanded ? styles.expanded : ""}`}
    >
      {/* Featured image — only on featured card with image */}
      {featured && article.image_url && (
        <div className={styles.imageWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url}
            alt=""
            className={styles.image}
            loading="lazy"
            onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
          />
        </div>
      )}

      <div className={styles.body}>
        {/* Meta row */}
        <div className={styles.meta}>
          <span className={styles.source}>{sourceName}</span>
          <span className={styles.dot} aria-hidden>·</span>
          <span className={styles.age}>{age}</span>
          {article.topic_tags?.length > 0 && (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <span className={styles.tag}>{article.topic_tags[0]}</span>
            </>
          )}
        </div>

        {/* Headline */}
        <h2 className={featured ? styles.headlineFeatured : styles.headline}>
          {article.headline}
        </h2>

        {/* Summary — expandable */}
        {article.summary && (
          <p className={`${styles.summary} ${expanded ? styles.summaryExpanded : ""}`}>
            {article.summary}
          </p>
        )}

        {/* Action row */}
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
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.readBtn}
            onClick={() => {
              // Reading event hook (Build 4) goes here
            }}
          >
            Read full story
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
              <path d="M1 10L10 1M10 1H4M10 1V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </article>
  );
}
