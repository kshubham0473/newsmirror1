"use client";

import { useState } from "react";
import styles from "./TopBar.module.css";

interface Source { id: string; name: string; }
type ViewMode = "cards" | "list";

interface Props {
  sources: Source[];
  activeSource: string | null;
  onSourceChange: (id: string | null) => void;
  search: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSettingsClick: () => void;
}

export default function TopBar({
  sources, activeSource, onSourceChange,
  search, onSearchChange,
  viewMode, onViewModeChange,
  onSettingsClick,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const activeSourceName = sources.find((s) => s.id === activeSource)?.name;

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <div className={styles.wordmark}>
          <span className={styles.logo}>NM</span>
          <span className={styles.name}>NewsMirror</span>
        </div>

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

          {/* View toggle */}
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

          {/* Source filter */}
          <div className={styles.sourceWrap}>
            <button
              className={`${styles.sourceBtn} ${activeSource ? styles.sourceBtnActive : ""}`}
              onClick={() => setSourceOpen((v) => !v)}
            >
              <span className={styles.sourceBtnText}>{activeSourceName ?? "All"}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {sourceOpen && (
              <>
                <div className={styles.backdrop} onClick={() => setSourceOpen(false)} />
                <div className={styles.sourceDropdown}>
                  <button
                    className={`${styles.sourceOption} ${!activeSource ? styles.sourceOptionActive : ""}`}
                    onClick={() => { onSourceChange(null); setSourceOpen(false); }}
                  >All sources</button>
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      className={`${styles.sourceOption} ${activeSource === s.id ? styles.sourceOptionActive : ""}`}
                      onClick={() => { onSourceChange(s.id); setSourceOpen(false); }}
                    >{s.name}</button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Settings / preferences */}
          <button className={styles.iconBtn} onClick={onSettingsClick} aria-label="Preferences">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.54 11.54l1.41 1.41M3.05 12.95l1.42-1.42M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
