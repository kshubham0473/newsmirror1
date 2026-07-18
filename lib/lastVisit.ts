/**
 * Last-visit tracking for the catch-up delta ("while you were away").
 * A new "visit" starts when the app loads without an active session flag.
 * Re-opens within the same browser session don't reset the away-window.
 */

const LS_KEY = "nm_last_visit";
const SS_KEY = "nm_session_active";
const MIN_AWAY_MS = 30 * 60 * 1000; // gaps under 30 min don't count as "away"

/** Call once on feed mount. Returns the away-cutoff timestamp, or null. */
export function beginVisit(): number | null {
  if (typeof window === "undefined") return null;
  try {
    if (sessionStorage.getItem(SS_KEY)) return null; // same session — no delta
    sessionStorage.setItem(SS_KEY, "1");
    const prev = Number(localStorage.getItem(LS_KEY) ?? 0);
    localStorage.setItem(LS_KEY, String(Date.now()));
    if (!prev || Date.now() - prev < MIN_AWAY_MS) return null;
    return prev;
  } catch {
    return null;
  }
}
