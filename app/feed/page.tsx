/* eslint-disable @typescript-eslint/no-explicit-any */
import { createStaticClient } from "@/lib/supabase-static";
import FeedClient from "@/components/feed/FeedClient";

export const revalidate = 60;

// Max articles per source in the feed — prevents any single outlet dominating
const MAX_PER_SOURCE = 12;
// How many total articles to fetch before quality ranking
const FETCH_LIMIT = 200;

export default async function FeedPage() {
  const supabase = createStaticClient();

  // 1. Fetch a wider pool of recent articles (with framing data from story_clusters)
  const { data, error } = await supabase
    .from("articles")
    .select(`
      id, source_id, url, headline, body, summary, image_url,
      published_at, ingested_at, topic_tags, key_entities,
      identity_score, state_trust_score, economic_score, institution_score,
      sources ( id, name, home_url, language ),
      article_clusters (
        cluster_id,
        story_clusters (
          id,
          framing_insight,
          divergence_score,
          framing_groups
        )
      )
    `)
    .not("summary", "is", null)
    .neq("summary", "")
    .neq("summary", "[skipped]")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("ingested_at", { ascending: false })
    .limit(FETCH_LIMIT);

  if (error) console.error("Feed fetch error:", error);

  const raw = data ?? [];

  // 2. Collect cluster IDs from this pool
  const allClusterIds = Array.from(
    new Set(
      raw
        .flatMap((a: any) => a.article_clusters?.map((ac: any) => ac.cluster_id) ?? [])
        .filter(Boolean)
    )
  );

  // 3. Fetch cluster source counts
  let clusterSourceCounts: Record<string, number> = {};
  if (allClusterIds.length > 0) {
    const { data: summaryRows } = await supabase
      .from("cluster_summary")
      .select("cluster_id, source_count")
      .in("cluster_id", allClusterIds);
    clusterSourceCounts = Object.fromEntries(
      (summaryRows ?? []).map((r: any) => [r.cluster_id, r.source_count])
    );
  }

  // 4. Flatten cluster info + framing data onto each article
  const withCluster = raw.map((a: any) => {
    const firstAc = a.article_clusters?.[0];
    const clusterId = firstAc?.cluster_id ?? null;
    const storyCluster = firstAc?.story_clusters?.[0] ?? null;
    const clusterSources = clusterId ? (clusterSourceCounts[clusterId] ?? 1) : 1;
    return {
      ...a,
      cluster_id: clusterId,
      cluster_source_count: clusterSources,
      cluster_framing_insight: storyCluster?.framing_insight ?? null,
      cluster_divergence_score: storyCluster?.divergence_score ?? null,
      cluster_framing_groups: storyCluster?.framing_groups ?? null,
    };
  });

  // 4b. Cluster peers — how OTHER outlets headlined the same story.
  //     Powers the flip for every multi-outlet card, even before the LLM
  //     framing analysis reaches that cluster.
  const byCluster = new Map<string, any[]>();
  for (const a of withCluster) {
    if (!a.cluster_id) continue;
    if (!byCluster.has(a.cluster_id)) byCluster.set(a.cluster_id, []);
    byCluster.get(a.cluster_id)!.push(a);
  }
  for (const a of withCluster) {
    if (!a.cluster_id || (a.cluster_source_count ?? 0) < 2) continue;
    const seenSrc = new Set<string>([a.source_id]);
    a.cluster_peers = (byCluster.get(a.cluster_id) ?? [])
      .filter((p: any) => {
        if (p.id === a.id || seenSrc.has(p.source_id)) return false;
        seenSrc.add(p.source_id);
        return true;
      })
      .slice(0, 4)
      .map((p: any) => ({ source: p.sources?.name ?? "—", headline: p.headline }));
  }

  // 5. Source cap — max MAX_PER_SOURCE per source before scoring
  const sourceSeen: Record<string, number> = {};
  const capped = withCluster.filter((a: any) => {
    const n = sourceSeen[a.source_id] ?? 0;
    if (n >= MAX_PER_SOURCE) return false;
    sourceSeen[a.source_id] = n + 1;
    return true;
  });

  // 6. Quality score — recency (65%) + cluster significance (35%)
  //    age decays linearly over 48h
  //    cluster score scales 0→1 for 1→5 sources covering the story
  const now = Date.now();
  const scored = capped.map((a: any) => {
    const publishedMs = a.published_at
      ? new Date(a.published_at).getTime()
      : new Date(a.ingested_at).getTime();
    const ageHours = (now - publishedMs) / 3_600_000;
    const ageScore = Math.max(0, 1 - ageHours / 48);
    const clusterScore = Math.min(1, ((a.cluster_source_count ?? 1) - 1) / 4);
    return { ...a, _score: 0.65 * ageScore + 0.35 * clusterScore };
  });

  // 7. Sort by score, take top 120, strip internal field
  const articles = scored
    .sort((a: any, b: any) => b._score - a._score)
    .slice(0, 120)
    .map(({ _score: _s, ...a }: any) => a);

  // 8. Build Top Stories: unique clusters with 3+ sources, sorted by source count desc
  //    De-duplicate by cluster_id — one representative article per cluster
  const seenClusterIds = new Set<string>();
  const topClusters = withCluster
    .filter((a: any) => {
      if (!a.cluster_id) return false;
      if ((a.cluster_source_count ?? 0) < 2) return false;
      if (seenClusterIds.has(a.cluster_id)) return false;
      seenClusterIds.add(a.cluster_id);
      return true;
    })
    .sort((a: any, b: any) => {
      // "Now" means now: fresh clusters first (6h/12h/older buckets), breadth
      // of coverage second. A stale analyzed cluster must not beat breaking news.
      const ageBucket = (x: any) => {
        const h = (Date.now() - new Date(x.published_at ?? x.ingested_at).getTime()) / 3600000;
        return h < 6 ? 0 : h < 12 ? 1 : 2;
      };
      const ab = ageBucket(a), bb = ageBucket(b);
      if (ab !== bb) return ab - bb;
      return (b.cluster_source_count ?? 0) - (a.cluster_source_count ?? 0);
    })
    .slice(0, 12)
    .map(({ _score: _s, ...a }: any) => a);

  // 8b. Latest "what changed" beat per cluster — powers the catch-up delta
  const beats: Record<string, string> = {};
  if (allClusterIds.length > 0) {
    const { data: beatRows } = await supabase
      .from("cluster_beats")
      .select("cluster_id, beat, created_at")
      .in("cluster_id", allClusterIds)
      .order("created_at", { ascending: false })
      .limit(120);
    for (const r of (beatRows ?? []) as any[]) {
      if (!beats[r.cluster_id]) beats[r.cluster_id] = r.beat; // first = newest
    }
  }

  // 9. Developing Threads (curated) — the masthead strip + in-feed doorway card
  const { data: topThreads } = await supabase
    .from("threads")
    .select("id, title, anchor_entity, status, article_count, source_count, first_seen, last_article_at, synthesis, spectrum_spread")
    .in("status", ["developing", "steady"])
    .not("curated_at", "is", null)
    .order("last_article_at", { ascending: false })
    .limit(5);
  const threadsList = topThreads ?? [];
  const topThread = threadsList.find((t: any) => t.status === "developing" && t.synthesis) ?? null;

  return (
    <FeedClient
      initialArticles={articles as any}
      topClusters={topClusters as any}
      topThread={topThread as any}
      threadsStrip={threadsList as any}
      beats={beats}
    />
  );
}
