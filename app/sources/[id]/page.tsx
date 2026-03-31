/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase";

export const revalidate = 300;

interface Props {
  params: { id: string };
}

export default async function SourceProfilePage({ params }: Props) {
  const supabase = createClient();

  const { data: source } = await supabase
    .from("sources")
    .select("id, name, home_url, language, rss_url")
    .eq("id", params.id)
    .maybeSingle();

  if (!source) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-sm text-neutral-400">
        <p>Source not found.</p>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("source_ideology_scores")
    .select("article_sample_count, identity_score, state_trust_score, economic_score, institution_score")
    .eq("source_id", source.id)
    .maybeSingle();

  const { data: examples } = await supabase
    .from("articles")
    .select("id, url, headline, summary, identity_score, state_trust_score, economic_score, institution_score, classifier_rationale")
    .eq("source_id", source.id)
    .not("summary", "is", null)
    .not("classifier_rationale", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(3);

  const ready = profile && profile.article_sample_count >= 10;

  const axes = [
    {
      key: "identity",
      label: "Identity framing",
      description:
        "How often coverage centres majority vs minority communities, and whether language is plural or majoritarian.",
    },
    {
      key: "state",
      label: "State narrative",
      description:
        "Whether government claims are questioned or largely reproduced at face value, and how often opposition voices appear.",
    },
    {
      key: "economy",
      label: "Economic framing",
      description:
        "Balance between growth and markets on one side, and labour, inequality, or welfare impact on the other.",
    },
    {
      key: "institutions",
      label: "Institutional tone",
      description:
        "How courts, RBI, Election Commission and other watchdogs are described – deferential, neutral, or critical.",
    },
  ] as const;

  const axisStrength = (value: number | null | undefined) => {
    if (value == null) return "Neutral";
    const diff = Math.abs(value - 0.5);
    if (diff < 0.15) return "Neutral";
    if (diff < 0.3) return "Subtle tilt";
    return "Distinct tilt";
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-10">
      <header className="space-y-3">
        <a
          href="/sources"
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M9 2L4 7l5 5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          All sources
        </a>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold border border-neutral-700">
                {source.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">{source.name}</h1>
                <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                  {source.language.toUpperCase()} · {ready ? "Profile ready" : "Profile building"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            {source.home_url && (
              <a
                href={source.home_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-neutral-400 hover:text-neutral-200 underline-offset-4 hover:underline"
              >
                Visit homepage
              </a>
            )}
            {source.rss_url && (
              <p className="text-[11px] text-neutral-500 truncate max-w-[220px]">
                {source.rss_url.replace(/^https?:\/\//, "")}
              </p>
            )}
          </div>
        </div>
        <p className="text-sm text-neutral-400 max-w-2xl">
          We infer this profile from how {source.name} has covered stories in the last 90 days – focusing on framing,
          emphasis and editorial choices, not whether any single article is \"right\" or \"wrong\".
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {axes.map((axis) => {
          const rawValue = profile ? (profile as any)[`${axis.key}_score`] ?? null : null;
          const strength = axisStrength(rawValue);
          return (
            <div
              key={axis.key}
              className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">{axis.label}</p>
                  <p className="text-[11px] text-neutral-400">{strength}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-neutral-800">
                    <span
                      className="h-full bg-emerald-400/80"
                      style={{
                        width:
                          rawValue == null
                            ? "40%"
                            : `${30 + Math.round(Math.abs(rawValue - 0.5) * 70)}%`,
                      }}
                    />
                  </span>
                  <span className="text-[10px] text-neutral-500">Relative editorial weight</span>
                </div>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">{axis.description}</p>
            </div>
          );
        })}
      </section>

      {examples && examples.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight text-white">Representative recent stories</h2>
          <p className="text-xs text-neutral-500 max-w-xl">
            A few of the stories the model looked at when shaping this profile. Rationale snippets are generated and
            may not match your reading perfectly, but they show the kind of framing we track.
          </p>
          <div className="space-y-3">
            {examples.map((a: any) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-2xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 hover:border-neutral-700 hover:bg-neutral-900/70 transition-colors"
              >
                <p className="text-xs text-neutral-500 mb-1">Story</p>
                <p className="text-sm font-medium text-white mb-1 line-clamp-2">{a.headline}</p>
                {a.summary && (
                  <p className="text-xs text-neutral-400 line-clamp-3 mb-2">{a.summary}</p>
                )}
                {a.classifier_rationale?.rationale && (
                  <div className="mt-1 grid gap-1.5 text-[11px] text-neutral-400 sm:grid-cols-2">
                    {a.classifier_rationale.rationale.identity && (
                      <p>
                        <span className="text-neutral-500">Identity: </span>
                        {a.classifier_rationale.rationale.identity}
                      </p>
                    )}
                    {a.classifier_rationale.rationale.state_trust && (
                      <p>
                        <span className="text-neutral-500">State: </span>
                        {a.classifier_rationale.rationale.state_trust}
                      </p>
                    )}
                    {a.classifier_rationale.rationale.economic && (
                      <p>
                        <span className="text-neutral-500">Economy: </span>
                        {a.classifier_rationale.rationale.economic}
                      </p>
                    )}
                    {a.classifier_rationale.rationale.institution && (
                      <p>
                        <span className="text-neutral-500">Institutions: </span>
                        {a.classifier_rationale.rationale.institution}
                      </p>
                    )}
                  </div>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-neutral-900 pt-6 mt-4">
        <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-2">How this works</h2>
        <p className="text-xs text-neutral-500 max-w-2xl">
          We never label any outlet as \"good\" or \"bad\". Instead, we look at framing choices across many articles –
          which voices are quoted, what gets emphasised, and how often institutions are questioned or praised. Raw
          model scores stay behind the scenes; what you see here is a softened, human-readable summary.
        </p>
      </section>
    </main>
  );
}
