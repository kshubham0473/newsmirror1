import { createClient } from "@/lib/supabase";
import FeedClient from "@/components/feed/FeedClient";

export const revalidate = 600;

export default async function FeedPage() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("articles")
    .select(`
      id, source_id, url, headline, body, summary, image_url,
      published_at, ingested_at, topic_tags,
      identity_score, state_trust_score, economic_score, institution_score,
      sources ( id, name, home_url, language )
    `)
    .not("summary", "is", null)
    .neq("summary", "")
    .order("published_at", { ascending: false })
    .limit(80);

  if (error) {
    console.error("Feed fetch error:", error);
  }

  return <FeedClient initialArticles={(data as unknown as any) ?? []} />;
}
```

Scroll down → click **Commit changes** → Vercel will redeploy automatically.

