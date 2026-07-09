/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import styles from "./threads.module.css";

export const revalidate = 300;

export const metadata = {
  title: "What's developing — NewsMirror",
  description: "The issues worth an opinion — followed across every side, as they unfold.",
};

function daysBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 1;
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5) + 1);
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  const hrs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function spreadWidth(spread: number[] | null): string {
  if (!spread || spread.length < 2) return "building";
  const w = Math.max(...spread) - Math.min(...spread);
  return w > 0.25 ? "wide split" : w > 0.12 ? "moderate" : "narrow";
}

export default async function ThreadsPage() {
  const supabase = createServerClient();

  const { data: threads, error } = await supabase
    .from("threads")
    .select("id, title, anchor_entity, status, article_count, source_count, first_seen, last_article_at, synthesis, spectrum_spread, synthesis_updated_at")
    .in("status", ["developing", "steady"])
    .not("curated_at", "is", null)
    .order("last_article_at", { ascending: false })
    .limit(8);

  if (error) console.error("Threads fetch error:", error);
  const list = (threads ?? []) as any[];

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/feed" className={styles.back}>← Briefing</Link>
      </header>

      <div className={styles.head}>
        <h1>What&rsquo;s <em>developing</em></h1>
        <p>The issues worth an opinion — followed across every side, as they unfold.</p>
      </div>
      <div className={styles.rule} />

      {list.length === 0 ? (
        <div className={styles.empty}>
          <p>No developing issues right now. Threads form as stories persist across days and sources — check back soon.</p>
        </div>
      ) : (
        list.map((t) => {
          const spread: number[] = Array.isArray(t.spectrum_spread) ? t.spectrum_spread : [];
          const days = daysBetween(t.first_seen, t.last_article_at);
          const gist = t.synthesis?.where_it_stands ?? null;
          return (
            <Link href={`/threads/${t.id}`} key={t.id} className={`${styles.card} ${t.status === "developing" ? styles.hot : ""}`}>
              <span className={`${styles.pill} ${t.status === "developing" ? styles.dev : styles.cool}`}>
                {t.status === "developing" ? "Developing" : "Steady"} · day {days}
              </span>
              <h2>{t.title ?? t.anchor_entity}</h2>
              {gist && <p className={styles.gist}>{gist}</p>}
              <div className={styles.meta}>
                <b>{t.source_count} outlets</b><i /><span>{t.article_count} articles</span><i /><span>updated {timeAgo(t.synthesis_updated_at ?? t.last_article_at)}</span>
              </div>
              {spread.length >= 2 && (
                <div className={styles.spreadWrap}>
                  <div className={styles.spreadLbl}><span>How outlets frame it</span><span>{spreadWidth(spread)}</span></div>
                  <div className={styles.spread}>
                    {spread.map((p, i) => (
                      <i key={i} style={{ left: `${Math.min(97, Math.max(3, p * 100))}%` }} />
                    ))}
                  </div>
                </div>
              )}
            </Link>
          );
        })
      )}

      <div className={styles.endMark}>❦</div>
    </div>
  );
}
