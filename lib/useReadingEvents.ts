"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

interface TrackParams {
  articleId: string;
  sourceId: string;
}

/**
 * Returns a trackRead function that writes a reading_event row.
 * No-ops silently if the user is not signed in or the write fails.
 * Fire-and-forget — never blocks navigation.
 */
export function useReadingEvents(user: User | null) {
  const trackRead = useCallback(
    ({ articleId, sourceId }: TrackParams) => {
      if (!user) return; // only track logged-in users

      const supabase = createClient();

      // Fire and forget — don't await, don't block the link click
      supabase
        .from("reading_events")
        .insert({
          user_id: user.id,
          article_id: articleId,
          source_id: sourceId,
          read_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.warn("reading_event write failed:", error.message);
        });
    },
    [user]
  );

  return { trackRead };
}
