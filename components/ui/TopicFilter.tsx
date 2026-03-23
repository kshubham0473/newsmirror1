"use client";

import styles from "./TopicFilter.module.css";

interface Topic {
  id: string;
  label: string;
}

interface Props {
  topics: readonly Topic[];
  active: string | null;
  onChange: (id: string | null) => void;
}

export default function TopicFilter({ topics, active, onChange }: Props) {
  return (
    <nav className={styles.nav} aria-label="Filter by topic">
      <div className={styles.track}>
        <button
          className={`${styles.pill} ${!active ? styles.pillActive : ""}`}
          onClick={() => onChange(null)}
        >
          All
        </button>
        {topics.map((t) => (
          <button
            key={t.id}
            className={`${styles.pill} ${active === t.id ? styles.pillActive : ""}`}
            onClick={() => onChange(active === t.id ? null : t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
