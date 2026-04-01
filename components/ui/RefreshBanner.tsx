'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import styles from './RefreshBanner.module.css';

const LAST_SEEN_KEY = 'nm_last_seen';

interface RefreshBannerProps {
  /** Called when user confirms load — parent should re-fetch articles */
  onRefresh: () => void;
  /** Pass the setter so this component can expose its isChecking state to TopBar */
  onCheckingChange?: (checking: boolean) => void;
}

export default function RefreshBanner({ onRefresh, onCheckingChange }: RefreshBannerProps) {
  const [newCount, setNewCount]     = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [dismissed, setDismissed]   = useState(false);

  const check = useCallback(async () => {
    setIsChecking(true);
    onCheckingChange?.(true);

    try {
      const supabase   = createClient();
      const lastSeen   = localStorage.getItem(LAST_SEEN_KEY);

      const query = supabase
        .from('articles')
        .select('id', { count: 'exact', head: true });

      if (lastSeen) {
        query.gt('ingested_at', lastSeen);
      }

      const { count } = await query;

      if (count && count > 0) {
        setNewCount(count);
      }
    } catch {
      // Silent fail — refresh banner is non-critical
    } finally {
      setIsChecking(false);
      onCheckingChange?.(false);
    }
  }, [onCheckingChange]);

  // Auto-check on mount
  useEffect(() => {
    check();
  }, [check]);

  function handleLoad() {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    setNewCount(null);
    setDismissed(false);
    onRefresh();
  }

  function handleDismiss() {
    setDismissed(true);
  }

  if (dismissed || newCount === null) return null;

  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>
        ↑ {newCount} new {newCount === 1 ? 'story' : 'stories'} available
      </span>
      <div className={styles.actions}>
        <button className={styles.loadBtn} onClick={handleLoad}>
          Load
        </button>
        <button className={styles.dismissBtn} onClick={handleDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

/**
 * Spinner icon — export separately so TopBar can show it
 * while the check is in progress, replacing the static refresh icon.
 */
export function RefreshSpinner() {
  return (
    <svg
      className={styles.spinner}
      width="16" height="16" viewBox="0 0 16 16"
      fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round"
    >
      <path d="M13 8a5 5 0 1 1-1.4-3.5" />
      <path d="M13 2v3.5H9.5" />
    </svg>
  );
}
