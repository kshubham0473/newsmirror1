"use client";

import { useState, useEffect } from "react";
import styles from "./InstallPrompt.module.css";

const SESSION_COUNT_KEY = "nm_session_count";
const INSTALL_DISMISSED_KEY = "nm_install_dismissed";
const SESSIONS_BEFORE_PROMPT = 3;

// Track sessions and decide whether to show the prompt
function shouldShowPrompt(): boolean {
  try {
    if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return false;
    const count = parseInt(localStorage.getItem(SESSION_COUNT_KEY) ?? "0", 10);
    return count >= SESSIONS_BEFORE_PROMPT;
  } catch {
    return false;
  }
}

function incrementSessionCount() {
  try {
    const count = parseInt(localStorage.getItem(SESSION_COUNT_KEY) ?? "0", 10);
    localStorage.setItem(SESSION_COUNT_KEY, String(count + 1));
  } catch { /* ignore */ }
}

export default function InstallPrompt() {
  const [show, setShow]       = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    incrementSessionCount();

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (shouldShowPrompt()) setShow(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Also show if already installable and session count met
    if (shouldShowPrompt() && (window.navigator as any).standalone !== true) {
      // On iOS standalone is not triggered, show a manual hint instead
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isInStandaloneMode = (window.navigator as any).standalone;
      if (isIos && !isInStandaloneMode) setShow(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") dismiss();
    }
    // iOS: just dismiss with a tip shown
  };

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, "1"); } catch { /* ignore */ }
  };

  if (!show) return null;

  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className={styles.banner}>
      <div className={styles.icon} aria-hidden>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="2" width="14" height="14" rx="3.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M9 5.5v5M6.5 8.5l2.5 2 2.5-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className={styles.text}>
        <span className={styles.textMain}>Add NewsMirror to home screen</span>
        {isIos && (
          <span className={styles.textSub}>Tap Share then "Add to Home Screen"</span>
        )}
      </div>
      {!isIos && (
        <button className={styles.installBtn} onClick={handleInstall}>
          Add
        </button>
      )}
      <button className={styles.dismissBtn} onClick={dismiss} aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
