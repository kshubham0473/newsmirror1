"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./BlotGlyph.module.css";

interface Props {
  /** Stories advanced past this session — the blot grows with it */
  count: number;
}

/**
 * The ambient mirror: a small Rorschach blot in the masthead.
 * Grows and drips as you read; tap opens /mirror.
 */
export default function BlotGlyph({ count }: Props) {
  const [dripping, setDripping] = useState(false);
  const prev = useRef(count);

  useEffect(() => {
    if (count > prev.current) {
      prev.current = count;
      setDripping(false);
      requestAnimationFrame(() => setDripping(true));
    }
  }, [count]);

  const scale = 1 + Math.min(count * 0.05, 0.28);

  return (
    <Link
      href="/mirror"
      className={styles.wrap}
      aria-label="Your mirror — see your reading reflection"
      title="Your mirror"
    >
      {dripping && <span className={styles.drip} onAnimationEnd={() => setDripping(false)} />}
      <svg viewBox="0 0 30 26" width="30" height="26" className={styles.svg} aria-hidden>
        <g
          fill="#5BBFB4"
          style={{ transform: `scale(${scale})`, transformOrigin: "15px 13px", transition: "transform .5s cubic-bezier(.2,.7,.2,1)" }}
        >
          <path d="M15 3 C11 5 7 4 5 8 C3 12 6 14 5 18 C4.5 21 8 24 11 22 C13 20.7 14 21.5 15 21.5 C16 21.5 17 20.7 19 22 C22 24 25.5 21 25 18 C24 14 27 12 25 8 C23 4 19 5 15 3 Z" />
        </g>
      </svg>
    </Link>
  );
}
