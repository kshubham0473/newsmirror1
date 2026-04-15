/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";
import FeedClient from "@/components/feed/FeedClient";

export const revalidate = 60;

// Max articles per source in the feed — prevents any single outlet dominating
const MAX_PER_SOURCE = 12;
// How many total articles to fetch before quality ranking
const FETCH_LIMIT = 200;

export default async function FeedPage() {
  const supabase = createClient();

  // 1. Fetch a wider pool of recent articles
  const { data, error } = await supabase
    .from("articles")
    .select(`
      id, source_id, url, headline, body, summary, image_url,
      published_at, ingested_at, topic_tags,
      identity_score, state_trust_score, economic_score, institution_score,
      sources ( id, name, home_url, language ),
      article_clusters ( cluster_id, story_clusters ( id ) )
    `)
    .not("summary", "is", null)
    .neq("summary", "")
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

  // 4. Flatten cluster info onto each article
  const withCluster = raw.map((a: any) => {
    const clusterId = a.article_clusters?.[0]?.cluster_id ?? null;
    const clusterSources = clusterId ? (clusterSourceCounts[clusterId] ?? 1) : 1;
    return { ...a, cluster_id: clusterId, cluster_source_count: clusterSources };
  });

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

  return <FeedClient initialArticles={articles as any} />;
}
