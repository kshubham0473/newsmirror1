/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";
import AdminSources from "@/components/admin/AdminSources";

export const revalidate = 0;

export default async function AdminPage() {
  const supabase = createClient();

  const { data: sources } = await supabase
    .from("sources")
    .select("id, name, rss_url, home_url, language, created_at")
    .order("name");

  // Article count per source
  const { data: counts } = await supabase
    .from("articles")
    .select("source_id")
    .not("summary", "is", null);

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    countMap[row.source_id] = (countMap[row.source_id] ?? 0) + 1;
  }

  const sourcesWithCounts = (sources ?? []).map((s: any) => ({
    ...s,
    article_count: countMap[s.id] ?? 0,
  }));

  return <AdminSources initialSources={sourcesWithCounts} />;
}
