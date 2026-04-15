"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type Reaction = 1 | -1 | null;

/**
 * Manages thumbs up/down reaction state for a single article.
 * - Upserts on new reaction
 * - Deletes if user taps the same reaction again (toggle off)
 * - No-ops silently if user is not signed in
 */
export function useArticleReaction(user: User | null, articleId: string) {
  const [reaction, setReaction] = useState<Reaction>(null);
  const [saving, setSaving] = useState(false);

  const react = useCallback(
    async (value: 1 | -1) => {
      if (!user || saving) return;

      const next: Reaction = reaction === value ? null : value;
      setReaction(next); // optimistic update

      setSaving(true);
      const supabase = createClient();

      try {
        if (next === null) {
          // Toggle off — delete the row
          await supabase
            .from("article_reactions")
            .delete()
            .eq("user_id", user.id)
            .eq("article_id", articleId);
        } else {
          // Upsert — handles both new reaction and switching up↔down
          await supabase
            .from("article_reactions")
            .upsert(
              { user_id: user.id, article_id: articleId, reaction: next },
              { onConflict: "user_id,article_id" }
            );
        }
      } catch (e) {
        console.warn("reaction write failed:", e);
        setReaction(reaction); // rollback on error
      } finally {
        setSaving(false);
      }
    },
    [user, articleId, reaction, saving]
  );

  return { reaction, react };
}
