"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Article } from "@/lib/types";
import FlipCard, { type ArticleWithFraming } from "./FlipCard";
import styles from "./SnapFeed.module.css";

const SEEN_KEY = "nm_seen_cards";
const SEEN_CAP = 200;

function markSeen(articleId: string) {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(articleId)) {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...ids, articleId].slice(-SEEN_CAP)));
    }
  } catch { /* ignore */ }
}

const SPEC_COLORS = ["var(--spec-cool)", "var(--spec-mid)", "var(--spec-warm)"];

function specColor(a: Article): string {
  const vals = [a.identity_score, a.state_trust_score, a.economic_score, a.institution_score]
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (!vals.length) return SPEC_COLORS[1];
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return avg < 0.4 ? SPEC_COLORS[0] : avg > 0.6 ? SPEC_COLORS[2] : SPEC_COLORS[1];
}

function timeAgoShort(dateStr: string | null): string {
  if (!dateStr) return "";
  const hrs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
  if (hrs < 1) return "now";
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Feed slots: 4 full cards, then 1 digest of 6 briefs, repeating. */
type Slot =
  | { kind: "story"; article: ArticleWithFraming; position: number }
  | { kind: "digest"; briefs: ArticleWithFraming[]; index: number }
  | { kind: "end" };

function buildSlots(articles: ArticleWithFraming[]): Slot[] {
  const slots: Slot[] = [];
  let i = 0;
  let position = 0;
  let digestIndex = 0;
  while (i < articles.length) {
    for (let c = 0; c < 4 && i < articles.length; c++) {
      position++;
      slots.push({ kind: "story", article: articles[i++], position });
    }
    if (i < articles.length) {
      const briefs = articles.slice(i, i + 6);
      i += 6;
      slots.push({ kind: "digest", briefs, index: digestIndex++ });
    }
  }
  slots.push({ kind: "end" });
  return slots;
}

interface Props {
  articles: ArticleWithFraming[];
  user?: User | null;
}

export default function SnapFeed({ articles, user = null }: Props) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0.04);
  const [readCount, setReadCount] = useState(0);
  const seenIdx = useRef(new Set<number>());

  const slots = useMemo(() => buildSlots(articles), [articles]);

  // Observe which slot is snapped → toggle .snapActive for reveal animations + mark seen
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const sections = Array.from(feed.querySelectorAll(`.${styles.snap}`));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          e.target.classList.toggle("snapActive", e.intersectionRatio > 0.6);
          if (e.intersectionRatio > 0.6) {
            const idx = sections.indexOf(e.target);
            if (idx >= 0 && !seenIdx.current.has(idx)) {
              seenIdx.current.add(idx);
              setReadCount(seenIdx.current.size);
              const slot = slots[idx];
              if (slot?.kind === "story") markSeen(slot.article.id);
            }
          }
        }
      },
      { root: feed, threshold: [0.6] }
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [slots]);

  const onScroll = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const max = feed.scrollHeight - feed.clientHeight;
    if (max > 0) setProgress(Math.max(0.04, feed.scrollTop / max));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.thread} aria-hidden>
        <i style={{ width: `${progress * 100}%` }} />
      </div>

      <div className={styles.feed} ref={feedRef} onScroll={onScroll}>
        {slots.map((slot, i) => {
          if (slot.kind === "story") {
            return (
              <section className={`${styles.snap} ${i === 0 ? "snapActive" : ""}`} key={slot.article.id}>
                <FlipCard article={slot.article} position={slot.position} user={user} />
              </section>
            );
          }
          if (slot.kind === "digest") {
            return (
              <section className={styles.snap} key={`digest-${slot.index}`}>
                <div className={styles.digest}>
                  <div className={styles.dHead}>
                    <div className={styles.dKick}>60-second catch-up</div>
                    <h2 className={styles.dTitle}>Six more, <em>briefly</em></h2>
                  </div>
                  <div className={styles.dList}>
                    {slot.briefs.map((b, j) => (
                      <a
                        key={b.id}
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.brief}
                      >
                        <i
                          className={`${styles.bDot} ${j < 2 ? styles.bDotPing : ""}`}
                          style={{ background: specColor(b), color: specColor(b) }}
                        />
                        <h4>{b.headline}</h4>
                        <span>{b.sources?.name ?? ""} · {timeAgoShort(b.published_at ?? b.ingested_at)}</span>
                      </a>
                    ))}
                  </div>
                  <div className={styles.dFoot}>Keep flicking for full stories</div>
                </div>
              </section>
            );
          }
          return (
            <section className={styles.snap} key="end">
              <div className={styles.endCard}>
                <svg viewBox="0 0 60 52" width="60" height="52" aria-hidden>
                  <path
                    d="M30 6 C22 10 14 8 10 16 C6 24 12 28 10 36 C9 42 16 48 22 44 C26 41.4 28 43 30 43 C32 43 34 41.4 38 44 C44 48 51 42 50 36 C48 28 54 24 50 16 C46 8 38 10 30 6 Z"
                    fill="#5BBFB4" opacity="0.9"
                  />
                </svg>
                <div className={styles.endFin}>That&rsquo;s today.</div>
                <p>You moved through <b>{readCount}</b> screens this session.<br />Fresh stories land every hour.</p>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
