"use client";

import { useState } from "react";
import { TOPICS } from "@/lib/types";
import type { TopicId } from "@/lib/types";
import type { UserPrefs } from "@/lib/usePreferences";
import styles from "./Onboarding.module.css";

interface Source { id: string; name: string; }

interface Props {
  sources: Source[];
  onDone: (prefs: Pick<UserPrefs, "topics" | "sources">) => void;
}

export default function Onboarding({ sources, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTopics, setSelectedTopics] = useState<TopicId[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  const toggleTopic = (id: TopicId) =>
    setSelectedTopics((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );

  const toggleSource = (id: string) =>
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );

  const finish = () => onDone({ topics: selectedTopics, sources: selectedSources });

  return (
    <div className={styles.overlay}>
      <div className={styles.screen}>

        {/* ── Header ── */}
        <div className={styles.header}>
          {step === 2 ? (
            <button className={styles.backBtn} onClick={() => setStep(1)} aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ) : (
            <div className={styles.wordmark}>News<span>Mirror</span></div>
          )}
          <div className={styles.stepDots}>
            <div className={`${styles.stepDot} ${styles.stepDotActive}`} />
            <div className={`${styles.stepDot} ${step === 2 ? styles.stepDotActive : ""}`} />
          </div>
        </div>

        {/* ── Step 1: Topics ── */}
        {step === 1 && (
          <>
            <div className={styles.intro}>
              <h1 className={styles.title}>What do you care about?</h1>
              <p className={styles.sub}>Pick topics to personalise your feed. You can change these anytime.</p>
            </div>

            <div className={styles.list}>
              {TOPICS.map((t) => {
                const active = selectedTopics.includes(t.id);
                return (
                  <button
                    key={t.id}
                    className={`${styles.listRow} ${active ? styles.listRowActive : ""}`}
                    onClick={() => toggleTopic(t.id)}
                  >
                    <div className={`${styles.checkbox} ${active ? styles.checkboxActive : ""}`}>
                      {active && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path d="M2.5 6l2.5 2.5 4.5-5"
                            stroke="#fff" strokeWidth="1.6"
                            strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={styles.listLabel}>{t.label}</span>
                  </button>
                );
              })}
            </div>

            <div className={styles.footer}>
              <button className={styles.skipBtn} onClick={() => setStep(2)}>Skip</button>
              <button className={styles.primaryBtn} onClick={() => setStep(2)}>
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Sources ── */}
        {step === 2 && (
          <>
            <div className={styles.intro}>
              <h1 className={styles.title}>Pick your sources</h1>
              <p className={styles.sub}>Follow specific outlets or skip to see everything.</p>
            </div>

            <div className={styles.list}>
              {sources.map((s) => {
                const active = selectedSources.includes(s.id);
                return (
                  <button
                    key={s.id}
                    className={`${styles.listRow} ${active ? styles.listRowActive : ""}`}
                    onClick={() => toggleSource(s.id)}
                  >
                    <div className={`${styles.checkbox} ${active ? styles.checkboxActive : ""}`}>
                      {active && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path d="M2.5 6l2.5 2.5 4.5-5"
                            stroke="#fff" strokeWidth="1.6"
                            strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={styles.listLabel}>{s.name}</span>
                  </button>
                );
              })}
            </div>

            <div className={styles.footer}>
              <button className={styles.skipBtn} onClick={finish}>Skip</button>
              <button className={styles.primaryBtn} onClick={finish}>
                Start reading
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
