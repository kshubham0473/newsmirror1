"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Article } from "@/lib/types";
import StoryCard from "./StoryCard";
import styles from "./CardFeed.module.css";

interface Props {
  articles: Article[];
}

type DragState = {
  active: boolean;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
};

export default function CardFeed({ articles }: Props) {
  const [index, setIndex] = useState(0);
  const [flyDir, setFlyDir] = useState<"left" | "right" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<DragState>({
    active: false, startX: 0, startY: 0, dx: 0, dy: 0,
  });
  const frontRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  const total = articles.length;
  const cur = index % total;
  const next1 = (index + 1) % total;
  const next2 = (index + 2) % total;

  const advance = useCallback((dir: "left" | "right") => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    setFlyDir(dir);
    setTimeout(() => {
      setIndex((i) => (i + 1) % total);
      setFlyDir(null);
      setDragX(0);
      setDragY(0);
      animatingRef.current = false;
    }, 340);
  }, [total]);

  // Pointer events for drag-to-dismiss
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (animatingRef.current) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
    };
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    dragRef.current.dx = dx;
    dragRef.current.dy = dy;
    setDragX(dx);
    setDragY(dy);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setIsDragging(false);
    const { dx } = dragRef.current;
    if (Math.abs(dx) > 80) {
      advance(dx < 0 ? "left" : "right");
    } else {
      setDragX(0);
      setDragY(0);
    }
  }, [advance]);

  // Clean up if pointer leaves window
  useEffect(() => {
    const up = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        setIsDragging(false);
        setDragX(0);
        setDragY(0);
      }
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  if (!articles.length) {
    return (
      <div className={styles.empty}>
        <p>No stories yet — check back soon.</p>
      </div>
    );
  }

  // Transform for the dragging front card
  const frontTransform = flyDir
    ? undefined // animation class handles it
    : isDragging
    ? `translateX(${dragX}px) translateY(${dragY * 0.2}px) rotate(${dragX * 0.05}deg)`
    : undefined;

  const frontOpacity = isDragging
    ? Math.max(0.3, 1 - Math.abs(dragX) / 200)
    : undefined;

  return (
    <div className={styles.wrap}>
      <div className={styles.stack}>

        {/* Card 3 — deepest, static */}
        <div
          className={`${styles.cardSlot} ${styles.slotBack2}`}
          style={{ background: "var(--card-cream)" }}
          aria-hidden
        >
          <StoryCard
            article={articles[next2]}
            isActive={false}
            position={(next2 % 3) + 1}
            total={total}
          />
        </div>

        {/* Card 2 — middle */}
        <div
          className={`${styles.cardSlot} ${styles.slotBack1} ${flyDir ? styles.promote : ""}`}
          style={{ background: "var(--card-blue)" }}
          aria-hidden
        >
          <StoryCard
            article={articles[next1]}
            isActive={false}
            position={(next1 % 3) + 1}
            total={total}
          />
        </div>

        {/* Card 1 — front, interactive */}
        <div
          ref={frontRef}
          className={`${styles.cardSlot} ${styles.slotFront} ${
            flyDir === "left" ? styles.flyLeft :
            flyDir === "right" ? styles.flyRight : ""
          } ${isDragging ? styles.dragging : ""}`}
          style={{
            transform: frontTransform,
            opacity: frontOpacity,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <StoryCard
            article={articles[cur]}
            isActive={true}
            position={(cur % 3) + 1}
            total={total}
            isDragging={isDragging}
          />
        </div>

      </div>

      {/* Swipe hint — fades out after 3s */}
      <div className={styles.hint} aria-hidden>
        <span className={styles.hintArrow}>←</span>
        swipe to next story
        <span className={styles.hintArrow}>→</span>
      </div>
    </div>
  );
}
