"use client";

import { useState, useEffect, useCallback } from "react";
import type { TopicId } from "@/lib/types";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export interface UserPrefs {
  topics: TopicId[];
  sources: string[]; // source IDs
  onboardingDone: boolean;
}

const DEFAULT_PREFS: UserPrefs = {
  topics: [],
  sources: [],
  onboardingDone: false,
};

const LS_KEY = "nm_prefs";

function readLocalPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_PREFS;
}

function writeLocalPrefs(prefs: UserPrefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// Migrate localStorage prefs to DB, then clear localStorage key
async function migrateToDb(user: User, prefs: UserPrefs) {
  const supabase = createClient();
  await supabase.from("user_preferences").upsert({
    user_id: user.id,
    topic_filters: prefs.topics,
    source_filters: prefs.sources,
    onboarding_done: prefs.onboardingDone,
  }, { onConflict: "user_id" });
  // Clear local copy after successful migration
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

async function loadDbPrefs(userId: string): Promise<UserPrefs | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("topic_filters, source_filters, onboarding_done")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return {
    topics: (data.topic_filters ?? []) as TopicId[],
    sources: data.source_filters ?? [],
    onboardingDone: data.onboarding_done ?? false,
  };
}

async function saveDbPrefs(userId: string, prefs: UserPrefs) {
  const supabase = createClient();
  await supabase.from("user_preferences").upsert({
    user_id: userId,
    topic_filters: prefs.topics,
    source_filters: prefs.sources,
    onboarding_done: prefs.onboardingDone,
  }, { onConflict: "user_id" });
}

export function usePreferences(user: User | null) {
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  // Load prefs — from DB if signed in, localStorage otherwise
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (user) {
        // Try DB first
        const dbPrefs = await loadDbPrefs(user.id);

        if (dbPrefs) {
          // DB row exists — use it
          if (!cancelled) { setPrefs(dbPrefs); setLoaded(true); }
        } else {
          // No DB row yet — migrate from localStorage
          const localPrefs = readLocalPrefs();
          await migrateToDb(user, localPrefs);
          if (!cancelled) { setPrefs(localPrefs); setLoaded(true); }
        }
      } else {
        // Signed out — use localStorage
        if (!cancelled) { setPrefs(readLocalPrefs()); setLoaded(true); }
      }
    }

    setLoaded(false);
    load();
    return () => { cancelled = true; };
  }, [user?.id]); // re-run when user changes

  // Unified save: writes to DB if signed in, localStorage otherwise
  const persist = useCallback((updated: UserPrefs) => {
    if (user) {
      saveDbPrefs(user.id, updated); // fire-and-forget
    } else {
      writeLocalPrefs(updated);
    }
  }, [user]);

  const save = useCallback((partial: Partial<UserPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleTopic = useCallback((id: TopicId) => {
    setPrefs((prev) => {
      const next = prev.topics.includes(id)
        ? prev.topics.filter((t) => t !== id)
        : [...prev.topics, id];
      const updated = { ...prev, topics: next };
      persist(updated);
      return updated;
    });
  }, [persist]);

  const toggleSource = useCallback((id: string) => {
    setPrefs((prev) => {
      const next = prev.sources.includes(id)
        ? prev.sources.filter((s) => s !== id)
        : [...prev.sources, id];
      const updated = { ...prev, sources: next };
      persist(updated);
      return updated;
    });
  }, [persist]);

  const completeOnboarding = useCallback(() => {
    save({ onboardingDone: true });
  }, [save]);

  return { prefs, loaded, save, toggleTopic, toggleSource, completeOnboarding };
}
