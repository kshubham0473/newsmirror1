"use client";

import Link from "next/link";
import { decodeEntities } from "@/lib/decodeEntities";
import styles from "./DeltaCard.module.css";

export interface DeltaItem {
  /** LLM beat line if available, else the newest headline */
  line: string;
  cluster_id: string | null;
  article_url: string;
  source_count: number;
  followed: boolean;
  age: string;
}

interface Props {
  items: DeltaItem[];
  awaySince: string; // e.g. "9:40 pm" or "yesterday 11 pm"
}

/** The catch-up delta — first card after a real away-gap. What changed, in the
 *  stories that matter to this reader, since they last left. */
export default function DeltaCard({ items, awaySince }: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.kick}>◔ Since {awaySince}</div>
      <h2 className={styles.title}>While you were <em>away</em></h2>

      <div className={styles.list}>
        {items.map((it, i) => {
          const inner = (
            <>
              <span className={`${styles.dot} ${it.followed ? styles.dotFollowed : ""}`} />
              <p className={styles.line}>
                {decodeEntities(it.line)}
                {it.followed && <span className={styles.followTag}>following</span>}
              </p>
              <span className={styles.meta}>
                {it.source_count >= 2 ? `${it.source_count} outlets` : it.age}
              </span>
            </>
          );
          return it.cluster_id ? (
            <Link key={i} href={`/timeline/${it.cluster_id}`} className={styles.row} prefetch>
              {inner}
            </Link>
          ) : (
            <a key={i} href={it.article_url} target="_blank" rel="noopener noreferrer" className={styles.row}>
              {inner}
            </a>
          );
        })}
      </div>

      <div className={styles.foot}>Flick down for the full stories</div>
    </div>
  );
}
