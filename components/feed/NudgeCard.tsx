"use client";

import type { User } from "@supabase/supabase-js";
import type { Nudge } from "@/lib/useNudge";
import { useReadingEvents } from "@/lib/useReadingEvents";
import { decodeEntities } from "@/lib/decodeEntities";
import styles from "./NudgeCard.module.css";

interface Props {
  nudge: Nudge;
  user?: User | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const hrs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
  if (hrs < 1) return "now";
  if (hrs < 24) return `${hrs}h`;
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** The mirror talks back: a contrasting lens on the reader's tilted axis. */
export default function NudgeCard({ nudge, user = null }: Props) {
  const { trackRead } = useReadingEvents(user);
  const { article } = nudge;
  const sourceName = article.sources?.name ?? "Unknown";

  return (
    <div className={styles.card}>
      <div className={styles.tag}>◑ Balancing your read</div>

      <p className={styles.why}>{nudge.whyLine}</p>

      <h2 className={styles.headline}>{decodeEntities(article.headline)}</h2>

      <div className={styles.meta}>
        <b>{sourceName}</b>
        <span>·</span>
        <span>{timeAgo(article.published_at ?? article.ingested_at)}</span>
        <span>·</span>
        <span>same news, different lens</span>
      </div>

      <div className={styles.pull}>
        <div className={styles.pullLabel}>Your pull on this axis</div>
        <div className={styles.pullBar}>
          <span className={styles.poolMark} style={{ left: `${nudge.baselinePos * 100}%` }} title="Pool average" />
          <span className={styles.youDot} style={{ left: `${nudge.footprintPos * 100}%` }} />
        </div>
      </div>

      <a
        className={styles.cta}
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackRead({ articleId: article.id, sourceId: article.source_id })}
      >
        Read the other lens →
      </a>
    </div>
  );
}
