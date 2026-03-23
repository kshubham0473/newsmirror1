"use client";

import { useState } from "react";
import styles from "./TopBar.module.css";

interface Source { id: string; name: string; }

interface Props {
  sources: Source[];
  activeSource: string | null;
  onSourceChange: (id: string | null) => void;
  search: string;
  onSearchChange: (q: string) => void;
}

export default function TopBar({
  sources, activeSource, onSourceChange, search, onSearchChange,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const activeSourceName = sources.find((s) => s.id === activeSource)?.name;

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        {/* Wordmark */}
        <div className={styles.wordmark}>
          <span className={styles.logo}>NM</span>
          <span className={styles.name}>NewsMirror</span>
        </div>

        {/* Right actions */}
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
                onBlur={() => {
                  if (!search) setSearchOpen(false);
                }}
              />
              <button
                className={styles.iconBtn}
                onClick={() => { onSearchChange(""); setSearchOpen(false); }}
                aria-label="Close search"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ) : (
            <button
              className={styles.iconBtn}
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {/* Source filter */}
          <div className={styles.sourceWrap}>
            <button
              className={`${styles.sourceBtn} ${activeSource ? styles.sourceBtnActive : ""}`}
              onClick={() => setSourceOpen((v) => !v)}
              aria-expanded={sourceOpen}
            >
              {activeSourceName ?? "All sources"}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {sourceOpen && (
              <div className={styles.sourceDropdown}>
                <button
                  className={`${styles.sourceOption} ${!activeSource ? styles.sourceOptionActive : ""}`}
                  onClick={() => { onSourceChange(null); setSourceOpen(false); }}
                >
                  All sources
                </button>
                {sources.map((s) => (
                  <button
                    key={s.id}
                    className={`${styles.sourceOption} ${activeSource === s.id ? styles.sourceOptionActive : ""}`}
                    onClick={() => { onSourceChange(s.id); setSourceOpen(false); }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
