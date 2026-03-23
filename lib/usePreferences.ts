"use client";

import { useState, useEffect, useCallback } from "react";
import type { TopicId } from "@/lib/types";

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

const KEY = "nm_prefs";

export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const save = useCallback((updated: Partial<UserPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...updated };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleTopic = useCallback((id: TopicId) => {
    setPrefs((prev) => {
      const next = prev.topics.includes(id)
        ? prev.topics.filter((t) => t !== id)
        : [...prev.topics, id];
      const updated = { ...prev, topics: next };
      try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  const toggleSource = useCallback((id: string) => {
    setPrefs((prev) => {
      const next = prev.sources.includes(id)
        ? prev.sources.filter((s) => s !== id)
        : [...prev.sources, id];
      const updated = { ...prev, sources: next };
      try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  const completeOnboarding = useCallback(() => {
    save({ onboardingDone: true });
  }, [save]);

  return { prefs, loaded, save, toggleTopic, toggleSource, completeOnboarding };
}
