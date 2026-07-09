/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import styles from "./thread.module.css";

export const revalidate = 300;

const SIDE_CLASSES = ["warm", "cool", "mid"] as const;

function daysBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 1;
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5) + 1);
}

function fmtDate(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  const today = new Date().toDateString() === date.toDateString();
  const label = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return today ? `Today · ${label}` : label;
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  const hrs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function ThreadPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient();

  const { data: thread } = await supabase
    .from("threads")
    .select("id, title, anchor_entity, status, article_count, source_count, first_seen, last_article_at, synthesis, spectrum_spread, synthesis_updated_at")
    .eq("id", params.id)
    .single();

  if (!thread) notFound();
  const t = thread as any;

  const { data: beats } = await supabase
    .from("thread_beats")
    .select("beat_date, headline, what_happened")
    .eq("thread_id", t.id)
    .order("beat_date", { ascending: false })
    .limit(20);

  const { data: links } = await supabase
    .from("thread_articles")
    .select("articles(id, headline, url, published_at, ingested_at, sources(name))")
    .eq("thread_id", t.id)
    .limit(12);
  const recentArticles = ((links ?? []) as any[])
    .map((l) => l.articles)
    .filter(Boolean)
    .sort((a, b) => (b.published_at ?? b.ingested_at ?? "").localeCompare(a.published_at ?? a.ingested_at ?? ""))
    .slice(0, 6);

  const synthesis = t.synthesis ?? null;
  const sides: any[] = Array.isArray(synthesis?.sides) ? synthesis.sides : [];
  const days = daysBetween(t.first_seen, t.last_article_at);

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/threads" className={styles.back}>← Threads</Link>
      </header>

      <div className={styles.hero}>
        <span className={`${styles.pill} ${t.status === "developing" ? styles.dev : styles.cool}`}>
          {t.status === "developing" ? "Developing" : "Steady"} · day {days}
        </span>
        <h1>{t.title ?? t.anchor_entity}</h1>
        <div className={styles.runline}>
          <b>{t.source_count} outlets</b><i /><span>{t.article_count} articles</span><i /><span>{fmtDate(t.first_seen)} → {fmtDate(t.last_article_at)}</span>
        </div>
      </div>

      {synthesis?.where_it_stands ? (
        <section className={styles.synth}>
          <div className={styles.kicker}>
            <span>◑ Where it stands</span>
            <span className={styles.upd}>updated {timeAgo(t.synthesis_updated_at)}</span>
          </div>
          <p className={styles.stand}>{synthesis.where_it_stands}</p>

          {sides.length > 0 && (
            <div className={styles.sides}>
              {sides.map((s, i) => (
                <div key={i} className={`${styles.side} ${styles[SIDE_CLASSES[i % 3]]}`}>
                  <div className={styles.who}>{(s.outlets ?? []).join(" · ")}{s.label ? ` · ${s.label}` : ""}</div>
                  <p>{s.emphasis}</p>
                </div>
              ))}
            </div>
          )}
          <p className={styles.disclaimer}>
            NewsMirror summarises how outlets are framing this issue. It does not take a position.
          </p>
        </section>
      ) : (
        <p className={styles.pending}>The brief for this thread is still being written — check back shortly.</p>
      )}

      {(beats ?? []).length > 0 && (
        <>
          <div className={styles.secLabel}>How it developed</div>
          <div className={styles.spine}>
            {(beats as any[]).map((b, i) => (
              <div key={`${b.beat_date}-${i}`} className={`${styles.beat} ${i === 0 ? styles.big : ""}`}>
                <span className={styles.node} />
                <div className={styles.date}>{fmtDate(b.beat_date)}</div>
                <h3>{b.headline}</h3>
                {b.what_happened && <p className={styles.what}>{b.what_happened}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {recentArticles.length > 0 && (
        <>
          <div className={styles.secLabel}>Latest coverage</div>
          <div className={styles.arts}>
            {recentArticles.map((a: any) => (
              <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className={styles.art}>
                <span className={styles.artSrc}>{a.sources?.name ?? "—"}</span>
                <span className={styles.artHl}>{a.headline}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <div className={styles.endMark}>❦</div>
    </div>
  );
}
