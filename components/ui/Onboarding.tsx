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

  const handleDone = () => {
    onDone({ topics: selectedTopics, sources: selectedSources });
  };

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.logo}>NM</div>
          <div>
            <h1 className={styles.title}>Welcome to NewsMirror</h1>
            <p className={styles.subtitle}>
              {step === 1
                ? "What topics do you care about?"
                : "Which sources do you want to follow?"}
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className={styles.steps}>
          <div className={`${styles.step} ${styles.stepDone}`} />
          <div className={`${styles.step} ${step === 2 ? styles.stepDone : ""}`} />
        </div>

        {/* Step 1 — Topics */}
        {step === 1 && (
          <div className={styles.body}>
            <p className={styles.hint}>
              Pick any that interest you — or skip to see everything.
            </p>
            <div className={styles.pillGrid}>
              {TOPICS.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.pill} ${selectedTopics.includes(t.id) ? styles.pillActive : ""}`}
                  onClick={() => toggleTopic(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Sources */}
        {step === 2 && (
          <div className={styles.body}>
            <p className={styles.hint}>
              Pick sources to follow — or skip to see all.
            </p>
            <div className={styles.sourceGrid}>
              {sources.map((s) => (
                <button
                  key={s.id}
                  className={`${styles.sourceCard} ${selectedSources.includes(s.id) ? styles.sourceCardActive : ""}`}
                  onClick={() => toggleSource(s.id)}
                >
                  <span className={styles.sourceName}>{s.name}</span>
                  {selectedSources.includes(s.id) && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={styles.checkIcon}>
                      <circle cx="7" cy="7" r="6" fill="var(--accent)" />
                      <path d="M4 7l2 2 4-4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          {step === 1 ? (
            <>
              <button className={styles.skipBtn} onClick={() => setStep(2)}>
                Skip
              </button>
              <button className={styles.nextBtn} onClick={() => setStep(2)}>
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </>
          ) : (
            <>
              <button className={styles.skipBtn} onClick={handleDone}>
                Skip
              </button>
              <button className={styles.nextBtn} onClick={handleDone}>
                Start reading
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
