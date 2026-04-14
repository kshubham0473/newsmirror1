/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";
import FeedClient from "@/components/feed/FeedClient";

export const revalidate = 60;

export default async function FeedPage() {
  const supabase = createClient();

  // Fetch articles with cluster info joined in
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
    .limit(80);

  if (error) console.error("Feed fetch error:", error);

  // Fetch source counts per cluster for the articles we got
  const clusterIds = [
    ...new Set(
      (data ?? [])
        .flatMap((a: any) => a.article_clusters?.map((ac: any) => ac.cluster_id) ?? [])
        .filter(Boolean)
    ),
  ];

  let clusterSourceCounts: Record<string, number> = {};
  if (clusterIds.length > 0) {
    const { data: summaryRows } = await supabase
      .from("cluster_summary")
      .select("cluster_id, source_count")
      .in("cluster_id", clusterIds);
    clusterSourceCounts = Object.fromEntries(
      (summaryRows ?? []).map((r: any) => [r.cluster_id, r.source_count])
    );
  }

  // Flatten cluster info onto each article
  const articles = (data ?? []).map((a: any) => {
    const clusterId = a.article_clusters?.[0]?.cluster_id ?? null;
    return {
      ...a,
      cluster_id: clusterId,
      cluster_source_count: clusterId ? (clusterSourceCounts[clusterId] ?? null) : null,
    };
  });

  return <FeedClient initialArticles={articles as any} />;
}

