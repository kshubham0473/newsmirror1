"use client";

import { useEffect, useState } from "react";
import { isFollowed, toggleFollow } from "@/lib/follows";
import { recordSignal, SIGNAL } from "@/lib/affinity";
import styles from "./FollowButton.module.css";

interface Props {
  /** Entity keys that define this story (article key_entities / thread anchor) */
  entities: string[] | null | undefined;
  /** Topic tags — following also feeds topic affinity */
  topics?: string[] | null;
  compact?: boolean;
}

export default function FollowButton({ entities, topics = null, compact = false }: Props) {
  const [following, setFollowing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setFollowing(isFollowed(entities));
  }, [entities]);

  if (!entities?.length || !mounted) return null;

  const onToggle = () => {
    const next = toggleFollow(entities);
    setFollowing(next);
    // Following is the strongest interest signal we have
    if (next) recordSignal(topics, SIGNAL.reactUp, entities);
  };

  return (
    <button
      className={`${styles.btn} ${following ? styles.on : ""} ${compact ? styles.compact : ""}`}
      onClick={onToggle}
      aria-pressed={following}
      aria-label={following ? "Unfollow this story" : "Follow this story"}
    >
      {following ? "✓ Following" : "+ Follow story"}
    </button>
  );
}
