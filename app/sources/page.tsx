/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";

export const revalidate = 300;

export default async function SourcesPage() {
  const supabase = createClient();

  const { data: sources } = await supabase
    .from("sources")
    .select("id, name, home_url, language")
    .order("name");

  const { data: profiles } = await supabase
    .from("source_ideology_scores")
    .select("source_id, article_sample_count, identity_score, state_trust_score, economic_score, institution_score");

  const profileMap = new Map<string, any>();
  for (const row of profiles ?? []) {
    profileMap.set(row.source_id, row);
  }

  const enriched = (sources ?? []).map((s: any) => ({
    ...s,
    profile: profileMap.get(s.id) ?? null,
  }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">NewsMirror</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Sources & editorial profiles</h1>
        <p className="text-sm text-neutral-500 max-w-xl">
          We read each outlet over the last 90 days and infer a soft profile of how it frames identity, the state,
          the economy, and institutions. No raw scores are shown here; only relative tendencies.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {enriched.map((source) => {
          const p = source.profile;
          const ready = p && p.article_sample_count >= 10;
          return (
            <a
              key={source.id}
              href={`/sources/${source.id}`}
              className="group rounded-2xl border border-neutral-800 bg-neutral-950/60 px-4 py-4 flex flex-col gap-3 hover:border-neutral-700 hover:bg-neutral-900/70 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium tracking-tight text-white flex items-center gap-1.5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold border border-neutral-700">
                      {source.name.charAt(0).toUpperCase()}
                    </span>
                    <span>{source.name}</span>
                  </div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                    {source.language.toUpperCase()} · {ready ? "Profile ready" : "Profile building"}
                  </p>
                </div>
                {ready && (
                  <div className="flex items-center gap-1 text-[11px] text-neutral-400">
                    <span className="inline-flex h-1.5 w-10 overflow-hidden rounded-full bg-neutral-800">
                      <span className="h-full w-1/2 bg-amber-400/80 group-hover:bg-amber-300/90 transition-colors" />
                    </span>
                    <span>View stance</span>
                  </div>
                )}
              </div>

              {ready ? (
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Based on {p.article_sample_count} recent stories, this outlet shows a distinct editorial pattern across identity,
                  the state, economy, and institutions.
                </p>
              ) : (
                <p className="text-xs text-neutral-500 leading-relaxed">
                  We are still reading this outlet. A profile appears once we have at least 10 representative articles.
                </p>
              )}
            </a>
          );
        })}
      </section>
    </main>
  );
}
