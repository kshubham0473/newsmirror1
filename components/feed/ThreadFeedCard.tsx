"use client";

import Link from "next/link";
import styles from "./ThreadFeedCard.module.css";

export interface FeedThread {
  id: string;
  title: string | null;
  anchor_entity: string;
  status: string;
  article_count: number;
  source_count: number;
  first_seen: string | null;
  last_article_at: string | null;
  synthesis: { where_it_stands?: string | null } | null;
  spectrum_spread: number[] | null;
}

function daysBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 1;
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5) + 1);
}

/** The rare in-feed doorway into a developing Thread. */
export default function ThreadFeedCard({ thread }: { thread: FeedThread }) {
  const days = daysBetween(thread.first_seen, thread.last_article_at);
  const gist = thread.synthesis?.where_it_stands ?? null;
  const spread = Array.isArray(thread.spectrum_spread) ? thread.spectrum_spread : [];

  return (
    <div className={styles.card}>
      <div className={styles.tk}>
        <span className={styles.live} /> Developing · day {days}
      </div>
      <h3 className={styles.title}>{thread.title ?? thread.anchor_entity}</h3>
      {gist && <p className={styles.gist}>{gist}</p>}
      <div className={styles.run}>
        <b>{thread.article_count} articles</b>
        <i />
        <span>{thread.source_count} outlets, every side</span>
      </div>
      {spread.length >= 2 && (
        <div className={styles.spread}>
          {spread.map((p, i) => (
            <i key={i} style={{ left: `${Math.min(97, Math.max(3, p * 100))}%` }} />
          ))}
        </div>
      )}
      <Link href={`/threads/${thread.id}`} className={styles.cta} prefetch>
        Open the thread →
      </Link>
    </div>
  );
}
