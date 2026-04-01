"use client";

import { type Dispatch, type SetStateAction } from "react";
import styles from "./TopicFilter.module.css";
import type { TopicId } from "@/lib/types";

interface Topic { id: string; label: string; }
interface Source { id: string; name: string; }

interface Props {
  topics: readonly Topic[];
  active: string | null;
  onChange: (id: string | null) => void;
  savedTopics?: TopicId[];
  sources?: Source[];
  activeSource?: string | null;
  onSourceChange?: Dispatch<SetStateAction<string | null>>;
}

export default function TopicFilter({
  topics,
  active,
  onChange,
  savedTopics = [],
  sources = [],
  activeSource = null,
  onSourceChange,
}: Props) {
  return (
    <nav className={styles.nav} aria-label="Filter by topic">
      {/* Topic pills */}
      <div className={styles.track}>
        <button
          className={`${styles.pill} ${!active ? styles.pillActive : ""}`}
          onClick={() => onChange(null)}
        >
          All
        </button>
        {topics.map((t) => {
          const isSaved = savedTopics.includes(t.id as TopicId);
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              className={`${styles.pill} ${isActive ? styles.pillActive : ""} ${isSaved && !isActive ? styles.pillSaved : ""}`}
              onClick={() => onChange(isActive ? null : t.id)}
            >
              {t.label}
              {isSaved && !isActive && <span className={styles.savedDot} aria-hidden />}
            </button>
          );
        })}
      </div>

      {/* Source filter row — only rendered when sources are provided */}
      {sources.length > 0 && onSourceChange && (
        <div className={styles.track}>
          <button
            className={`${styles.pill} ${!activeSource ? styles.pillActive : ""}`}
            onClick={() => onSourceChange(null)}
          >
            All sources
          </button>
          {sources.map((s) => {
            const isActive = activeSource === s.id;
            return (
              <button
                key={s.id}
                className={`${styles.pill} ${isActive ? styles.pillActive : ""}`}
                onClick={() => onSourceChange(isActive ? null : s.id)}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
