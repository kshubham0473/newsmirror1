"use client";

import { useState, useRef, useCallback } from "react";
import type { Article } from "@/lib/types";
import StoryCard from "./StoryCard";
import styles from "./CardFeed.module.css";

interface Props {
  articles: Article[];
}

export default function CardFeed({ articles }: Props) {
  const [index, setIndex] = useState(0);
  const [flyDir, setFlyDir] = useState<"left" | "right" | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // All mutable drag state lives in a ref — never causes re-renders mid-drag
  const drag = useRef({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
  const animating = useRef(false);

  const total = articles.length;
  const cur   = index % total;
  const nxt1  = (index + 1) % total;
  const nxt2  = (index + 2) % total;

  const dismiss = useCallback((dir: "left" | "right") => {
    if (animating.current) return;
    animating.current = true;
    setFlyDir(dir);
    setDragX(0);
    setDragY(0);
    setTimeout(() => {
      setIndex((i) => (i + 1) % total);
      setFlyDir(null);
      animating.current = false;
    }, 320);
  }, [total]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (animating.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { active: true, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 };
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    drag.current.dx = dx;
    drag.current.dy = dy;
    setDragX(dx);
    setDragY(dy);
  }, []);

  // Single handler — setPointerCapture means this always fires on the front card
  const onPointerUp = useCallback(() => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setIsDragging(false);
    const { dx } = drag.current;
    if (Math.abs(dx) > 75) {
      dismiss(dx < 0 ? "left" : "right");
    } else {
      setDragX(0);
      setDragY(0);
    }
  }, [dismiss]);

  if (!articles.length) {
    return <div className={styles.empty}><p>No stories yet — check back soon.</p></div>;
  }

  const frontStyle = flyDir ? undefined : isDragging ? {
    transform: `translateX(${dragX}px) translateY(${dragY * 0.18}px) rotate(${dragX * 0.045}deg)`,
    opacity: Math.max(0.3, 1 - Math.abs(dragX) / 200),
    transition: "none",
  } : { transform: undefined, opacity: undefined };

  return (
    <div className={styles.wrap}>
      <div className={styles.stack}>

        {/* Back card 2 */}
        <div className={`${styles.slot} ${styles.back2}`} aria-hidden>
          <StoryCard article={articles[nxt2]} isActive={false} position={(nxt2 % 3) + 1} total={total} />
        </div>

        {/* Back card 1 */}
        <div className={`${styles.slot} ${styles.back1} ${flyDir ? styles.promote : ""}`} aria-hidden>
          <StoryCard article={articles[nxt1]} isActive={false} position={(nxt1 % 3) + 1} total={total} />
        </div>

        {/* Front card */}
        <div
          className={`${styles.slot} ${styles.front} ${
            flyDir === "left"  ? styles.flyLeft  :
            flyDir === "right" ? styles.flyRight : ""
          } ${isDragging ? styles.dragging : ""}`}
          style={frontStyle as React.CSSProperties}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <StoryCard article={articles[cur]} isActive={true} position={(cur % 3) + 1} total={total} isDragging={isDragging} />
        </div>

      </div>

      <div className={styles.hint} aria-hidden>
        <span>←</span> swipe to next story <span>→</span>
      </div>
    </div>
  );
}
