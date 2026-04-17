"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ui/ThemeProvider";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import styles from "./TopBar.module.css";

type ViewMode = "cards" | "list";

const ADMIN_EMAIL = "shubhamk0473@gmail.com";

interface Props {
  search: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSettingsClick: () => void;
  isRefreshing: boolean;
  onRefreshClick?: () => void;
}

export default function TopBar({
  search, onSearchChange,
  viewMode, onViewModeChange,
  onSettingsClick,
  isRefreshing,
  onRefreshClick,
}: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  // Close overflow when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    if (overflowOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>

        {/* Left — identity */}
        <div className={styles.wordmark}>
          <span className={styles.logo}>NM</span>
          <span className={styles.name}>NewsMirror</span>
        </div>

        {/* Centre — view toggle */}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewBtn} ${viewMode === "cards" ? styles.viewBtnActive : ""}`}
            onClick={() => onViewModeChange("cards")}
            aria-label="Card view"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <rect x="1" y="1" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M4 13h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
            onClick={() => onViewModeChange("list")}
            aria-label="List view"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M5 4h8M5 8h8M5 12h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="2" cy="4" r="1" fill="currentColor"/>
              <circle cx="2" cy="8" r="1" fill="currentColor"/>
              <circle cx="2" cy="12" r="1" fill="currentColor"/>
            </svg>
          </button>
        </div>

        {/* Right — utilities */}
        <div className={styles.actions}>

          {/* Search */}
          {searchOpen ? (
            <div className={styles.searchWrap}>
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search stories…"
                className={styles.searchInput}
                onBlur={() => { if (!search) setSearchOpen(false); }}
              />
              <button
                className={styles.iconBtn}
                onClick={() => { onSearchChange(""); setSearchOpen(false); }}
                aria-label="Close search"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ) : (
            <button className={styles.iconBtn} onClick={() => setSearchOpen(true)} aria-label="Search">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {/* Refresh indicator — spins while isRefreshing */}
          <button
            className={`${styles.iconBtn} ${isRefreshing ? styles.iconBtnSpinning : ""}`}
            aria-label="Checking for new stories"
            disabled={isRefreshing}
            onClick={onRefreshClick}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4.5A5 5 0 0 1 13 8h-1.5M3 4.5V2M3 4.5h2.5M13 11.5A5 5 0 0 1 3 8h1.5M13 11.5V14M13 11.5h-2.5"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Theme toggle */}
          <button
            className={styles.iconBtn}
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <circle cx="8" cy="8" r="2.8"/>
                <line x1="8" y1="1.5" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="14.5"/>
                <line x1="1.5" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="14.5" y2="8"/>
                <line x1="3.3" y1="3.3" x2="4.4" y2="4.4"/><line x1="11.6" y1="11.6" x2="12.7" y2="12.7"/>
                <line x1="12.7" y1="3.3" x2="11.6" y2="4.4"/><line x1="4.4" y1="11.6" x2="3.3" y2="12.7"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M13.5 10A6 6 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z"/>
              </svg>
            )}
          </button>

          {/* Overflow "…" — settings + admin + sources */}
          <div className={styles.overflowWrap} ref={overflowRef}>
            <button
              className={`${styles.iconBtn} ${overflowOpen ? styles.iconBtnActive : ""}`}
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label="More options"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="4" cy="8" r="1.2" fill="currentColor"/>
                <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
                <circle cx="12" cy="8" r="1.2" fill="currentColor"/>
              </svg>
            </button>

            {overflowOpen && (
              <div className={styles.overflowMenu}>
                <button
                  className={styles.overflowItem}
                  onClick={() => { onSettingsClick(); setOverflowOpen(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                    <circle cx="8" cy="8" r="2"/>
                    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.54 11.54l1.41 1.41M3.05 12.95l1.42-1.42M11.54 4.46l1.41-1.41"/>
                  </svg>
                  Preferences
                </button>
                <Link
                  href="/sources"
                  className={styles.overflowItem}
                  onClick={() => setOverflowOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                    <rect x="2" y="3" width="12" height="9" rx="1.5"/>
                    <path d="M4 6h8M4 9h5"/>
                  </svg>
                  Source profiles
                </Link>
                {user?.email === ADMIN_EMAIL && (
                  <Link
                    href="/admin"
                    className={styles.overflowItem}
                    onClick={() => setOverflowOpen(false)}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                      <path d="M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14a6 6 0 0 1 12 0"/>
                    </svg>
                    Admin
                  </Link>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
