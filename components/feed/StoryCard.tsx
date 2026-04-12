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

function getLeanMeta(article: Article):
  | { label: string; strength: "low" | "high"; axis: "identity" | "state" | "economy" | "institutions" }
  | null {
  const { identity_score, state_trust_score, economic_score, institution_score } = article;

  const scores: { axis: "identity" | "state" | "economy" | "institutions"; value: number | null }[] = [
    { axis: "identity", value: identity_score },
    { axis: "state", value: state_trust_score },
    { axis: "economy", value: economic_score },
    { axis: "institutions", value: institution_score },
  ];

  const withDiff = scores
    .filter((s) => typeof s.value === "number")
    .map((s) => ({ ...s, diff: Math.abs((s.value as number) - 0.5) }));

  if (!withDiff.length) return null;

  const dominant = withDiff.reduce((best, curr) => (curr.diff > best.diff ? curr : best));

  // Ignore very small deviations from neutral
  if (dominant.diff < 0.12) return null;

  const strength: "low" | "high" = dominant.diff >= 0.25 ? "high" : "low";

  let label = "";
  switch (dominant.axis) {
    case "identity":
      label = "Identity framing";
      break;
    case "state":
      label = "State narrative";
      break;
    case "economy":
      label = "Economic framing";
      break;
    case "institutions":
      label = "Institutional tone";
      break;
  }

  return { label, strength, axis: dominant.axis };
}

export default function StoryCard({ article, isActive, position, total }: Props) {
  const [saved, setSaved] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!article.image_url && !imgFailed;
  const sourceName = article.sources?.name ?? "Unknown";
  const age = timeAgo(article.published_at ?? article.ingested_at);
  const tag = article.topic_tags?.[0];
  const leanMeta = getLeanMeta(article);

  return (
    <article
      className={`${styles.card} ${isActive ? styles.active : ""} ${hasImage ? styles.hasImage : ""}`}
    >
      {/* Background image — top 52% of card */}
      {hasImage && (
        <div className={styles.imageBg}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url!}
            alt=""
            className={styles.bgImg}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
          <div className={styles.overlayTop} />
        </div>
      )}
      {/* Gradient bridge from image into content area */}
      {hasImage && <div className={styles.overlayTransition} aria-hidden />}

      <div className={styles.content}>
        {/* ── Top meta bar with frosted pill ── */}
        <div className={styles.topBar}>
          <div className={styles.metaPill}>
            <span className={styles.source}>{sourceName}</span>
            {leanMeta && (
              <span
                className={`${styles.leanPill} ${styles[`leanPill_${leanMeta.axis}`]} ${styles[`leanPill_${leanMeta.strength}`]}`}
                title={leanMeta.label}
              >
                <span className={styles.leanDot} aria-hidden />
                <span className={styles.leanLabel}>{leanMeta.label}</span>
              </span>
            )}
            {tag && (
              <>
                <span className={styles.metaDivider} aria-hidden>
                  ·
                </span>
                <span className={styles.tag}>{tag}</span>
              </>
            )}
          </div>
          <div className={styles.metaPill}>
            <span className={styles.age}>{age}</span>
            <span className={styles.metaDivider} aria-hidden>
              ·
            </span>
            <span className={styles.counter}>
              {position}/{total}
            </span>
          </div>
        </div>

        {/* ── Spacer pushes body to bottom ── */}
        <div className={styles.spacer} />

        {/* ── Body: headline + summary ── */}
        <div className={styles.body}>
          <h2 className={styles.headline}>{article.headline}</h2>

          {article.summary && <p className={styles.summary}>{article.summary}</p>}

          {/* ── Actions ── */}
          <div className={styles.actions}>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.readBtn}
            >
              Read full story
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <path
                  d="M1 10L10 1M10 1H4M10 1V7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>

            <button
              className={`${styles.saveBtn} ${saved ? styles.saveBtnActive : ""}`}
              onClick={() => setSaved((v) => !v)}
              aria-label={saved ? "Unsave" : "Save"}
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
      </div>
    </article>
  );
}
