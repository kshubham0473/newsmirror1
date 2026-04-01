"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { Article } from "@/lib/types";
import StoryCard from "./StoryCard";
import styles from "./CardFeed.module.css";

interface Props {
  articles: Article[];
}

export default function CardFeed({ articles }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Update active index on scroll using IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    cardRefs.current.forEach((card, i) => {
      if (!card) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            setActiveIndex(i);
          }
        },
        { threshold: 0.6, root: containerRef.current }
      );
      obs.observe(card);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [articles]);

  const scrollTo = useCallback((index: number) => {
    cardRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  if (!articles.length) {
    return (
      <div className={styles.empty}>
        <p>No stories yet — check back soon.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {/* Light-mode gradient bridge between header and card image */}
      <div className={styles.topFade} aria-hidden />

      {/* Progress dots */}
      <div className={styles.dots} aria-hidden>
        {articles.slice(0, 12).map((_, i) => (
          <button
            key={i}
            className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ""}`}
            onClick={() => scrollTo(i)}
          />
        ))}
        {articles.length > 12 && (
          <span className={styles.dotMore}>+{articles.length - 12}</span>
        )}
      </div>

      {/* Card scroll container */}
      <div className={styles.scroller} ref={containerRef}>
        {articles.map((article, i) => (
          <div
            key={article.id}
            className={styles.slide}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
          >
            <StoryCard
              article={article}
              isActive={i === activeIndex}
              position={i + 1}
              total={articles.length}
            />
          </div>
        ))}
      </div>

      {/* Scroll hint — only on first card */}
      {activeIndex === 0 && (
        <div className={styles.hint} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M4 9l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <span>Scroll for next story</span>
        </div>
      )}
    </div>
  );
}
