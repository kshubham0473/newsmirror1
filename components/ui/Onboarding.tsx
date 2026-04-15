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

// Each topic gets a pastel colour and a size — creates visual variety
const TOPIC_STYLES: Record<string, { color: string; size: "sm" | "md" | "lg" }> = {
  "politics":       { color: "#FFE8E5", size: "lg" },
  "economy":        { color: "#FFF2C5", size: "lg" },
  "judiciary":      { color: "#E0F1FF", size: "md" },
  "foreign-policy": { color: "#FFE8E5", size: "md" },
  "environment":    { color: "#E0F1FF", size: "md" },
  "science-tech":   { color: "#FFF2C5", size: "lg" },
  "health":         { color: "#FFE8E5", size: "md" },
  "sports":         { color: "#FFF2C5", size: "md" },
  "education":      { color: "#E0F1FF", size: "sm" },
  "society":        { color: "#FFE8E5", size: "sm" },
  "business":       { color: "#FFF2C5", size: "sm" },
  "defence":        { color: "#E0F1FF", size: "sm" },
};

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

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.wordmark}>News<span>Mirror</span></div>
          <div className={styles.stepDots}>
            <div className={`${styles.stepDot} ${styles.stepDotActive}`} />
            <div className={`${styles.stepDot} ${step === 2 ? styles.stepDotActive : ""}`} />
          </div>
        </div>

        {step === 1 && (
          <>
            <div className={styles.intro}>
              <h1 className={styles.title}>What do you care about?</h1>
              <p className={styles.sub}>Tap topics to personalise your feed. Skip to see everything.</p>
            </div>

            {/* Floating bubble grid */}
            <div className={styles.bubbleGrid}>
              {TOPICS.map((t) => {
                const ts = TOPIC_STYLES[t.id] ?? { color: "#FFE8E5", size: "md" };
                const active = selectedTopics.includes(t.id);
                return (
                  <button
                    key={t.id}
                    className={`${styles.bubble} ${styles[`bubble_${ts.size}`]} ${active ? styles.bubbleActive : ""}`}
                    style={{
                      background: active ? ts.color : "rgba(255,255,255,0.06)",
                      borderColor: active ? ts.color : "rgba(255,255,255,0.09)",
                      color: active ? "#111111" : "rgba(255,255,255,0.55)",
                    }}
                    onClick={() => toggleTopic(t.id)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className={styles.footer}>
              <button className={styles.skipBtn} onClick={() => setStep(2)}>Skip</button>
              <button className={styles.nextBtn} onClick={() => setStep(2)}>
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className={styles.intro}>
              <h1 className={styles.title}>Pick your sources</h1>
              <p className={styles.sub}>Follow specific outlets or skip to see all of them.</p>
            </div>

            <div className={styles.sourceGrid}>
              {sources.map((s, i) => {
                const colors = ["#FFE8E5", "#E0F1FF", "#FFF2C5"];
                const c = colors[i % 3];
                const active = selectedSources.includes(s.id);
                return (
                  <button
                    key={s.id}
                    className={`${styles.sourceChip} ${active ? styles.sourceChipActive : ""}`}
                    style={{
                      background: active ? c : "rgba(255,255,255,0.05)",
                      borderColor: active ? c : "rgba(255,255,255,0.08)",
                      color: active ? "#111111" : "rgba(255,255,255,0.55)",
                    }}
                    onClick={() => toggleSource(s.id)}
                  >
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={styles.checkIcon}>
                        <path d="M2 6l3 3 5-5" stroke="#111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {s.name}
                  </button>
                );
              })}
            </div>

            <div className={styles.footer}>
              <button className={styles.skipBtn} onClick={() => onDone({ topics: selectedTopics, sources: selectedSources })}>
                Skip
              </button>
              <button className={styles.nextBtn} onClick={() => onDone({ topics: selectedTopics, sources: selectedSources })}>
                Start reading
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
