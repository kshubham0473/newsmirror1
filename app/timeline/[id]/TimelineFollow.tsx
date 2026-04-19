"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase";
import styles from "./TimelinePage.module.css";

interface Props {
  clusterId: string;
  userId: string | null;
  initialFollowing: boolean;
}

export default function TimelineFollow({ clusterId, userId, initialFollowing }: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    if (!userId) return;
    const supabase = createClient();
    startTransition(async () => {
      if (following) {
        await supabase
          .from("cluster_follows")
          .delete()
          .eq("user_id", userId)
          .eq("cluster_id", clusterId);
        setFollowing(false);
      } else {
        await supabase
          .from("cluster_follows")
          .insert({ user_id: userId, cluster_id: clusterId });
        setFollowing(true);
      }
    });
  };

  if (!userId) {
    return (
      <span className={styles.followGated}>
        Sign in to follow
      </span>
    );
  }

  return (
    <button
      className={`${styles.followBtn} ${following ? styles.followBtnActive : ""}`}
      onClick={toggle}
      disabled={isPending}
      aria-pressed={following}
    >
      {following ? (
        <>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <path d="M2 7l3 3 6-6" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Following
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" />
          </svg>
          Follow story
        </>
      )}
    </button>
  );
}
