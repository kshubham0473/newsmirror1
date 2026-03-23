"use client";

import styles from "./TopicFilter.module.css";
import type { TopicId } from "@/lib/types";

interface Topic { id: string; label: string; }

interface Props {
  topics: readonly Topic[];
  active: string | null;
  onChange: (id: string | null) => void;
  savedTopics?: TopicId[];
}

export default function TopicFilter({ topics, active, onChange, savedTopics = [] }: Props) {
  return (
    <nav className={styles.nav} aria-label="Filter by topic">
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
    </nav>
  );
}
