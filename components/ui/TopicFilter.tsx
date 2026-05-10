"use client";

import { useState } from "react";
import styles from "./TopicFilter.module.css";

interface Source {
  id: string;
  name: string;
}

interface Topic {
  id: string;
  label: string;
}

interface Props {
  topics: Topic[];
  activeTopic: string | null;
  onTopicChange: (id: string | null) => void;
  savedTopics?: string[];
  sources: Source[];
  activeSource: string | null;
  onSourceChange: (id: string | null) => void;
}

export default function TopicFilter({
  topics,
  activeTopic,
  onTopicChange,
  savedTopics = [],
  sources,
  activeSource,
  onSourceChange,
}: Props) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const activeSourceName = sources.find((s) => s.id === activeSource)?.name;

  return (
    <div className={styles.row}>
      {/* Topic pills — scrollable */}
      <div className={styles.pills}>
        <button
          className={`${styles.pill} ${!activeTopic ? styles.pillActive : ""}`}
          onClick={() => onTopicChange(null)}
        >
          All
        </button>
        {topics.map((t) => (
          <button
            key={t.id}
            className={`${styles.pill} ${activeTopic === t.id ? styles.pillActive : ""}`}
            onClick={() => onTopicChange(t.id)}
          >
            {t.label}
            {savedTopics.includes(t.id) && (
              <span className={styles.savedDot} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {/* Source filter — pinned right */}
      <div className={styles.sourceWrap}>
        <button
          className={`${styles.sourceBtn} ${activeSource ? styles.sourceBtnActive : ""}`}
          onClick={() => setSourceOpen((v) => !v)}
          aria-label="Filter by source"
          aria-expanded={sourceOpen}
        >
          <span className={styles.sourceBtnText}>
            {activeSourceName ?? "All sources"}
          </span>
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            className={sourceOpen ? styles.chevronUp : ""}
          >
            <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {sourceOpen && (
          <>
            <div className={styles.backdrop} onClick={() => setSourceOpen(false)} />
            <div className={styles.dropdown}>
              <button
                className={`${styles.option} ${!activeSource ? styles.optionActive : ""}`}
                onClick={() => { onSourceChange(null); setSourceOpen(false); }}
              >
                All sources
              </button>
              {sources.map((s) => (
                <button
                  key={s.id}
                  className={`${styles.option} ${activeSource === s.id ? styles.optionActive : ""}`}
                  onClick={() => { onSourceChange(s.id); setSourceOpen(false); }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
