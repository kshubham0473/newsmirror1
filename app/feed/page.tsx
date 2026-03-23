import { createClient } from "@/lib/supabase";
import FeedClient from "@/components/feed/FeedClient";
import type { Article } from "@/lib/types";

// Revalidate every 10 minutes
export const revalidate = 600;

export default async function FeedPage() {
  const supabase = createClient();

  const { data: articles, error } = await supabase
    .from("articles")
    .select(`
      id, source_id, url, headline, summary, image_url,
      published_at, ingested_at, topic_tags,
      sources ( id, name, home_url, language )
    `)
    .not("summary", "is", null)
    .neq("summary", "")
    .order("published_at", { ascending: false })
    .limit(80);

  if (error) {
    console.error("Feed fetch error:", error);
  }

  return <FeedClient initialArticles={(articles as Article[]) ?? []} />;
}
