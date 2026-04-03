// supabase/functions/ingest-articles/index.ts
// Deploy: supabase functions deploy ingest-articles
// Schedule via GitHub Actions (see .github/workflows/ingest.yml): "0 */5 * * *" (every 5 hours)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

// ─── RSS PARSING ──────────────────────────────────────────────────────────────

interface RssItem {
  url: string;
  headline: string;
  body: string;
  image_url: string | null;
  published_at: string | null;
}

async function fetchRssFeed(rssUrl: string): Promise<RssItem[]> {
  const res = await fetch(rssUrl, {
    headers: { "User-Agent": "NewsMirror/1.0 (RSS Reader)" },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${rssUrl}`);
  const xml = await res.text();
  return parseRss(xml);
}

function stripCdata(value: string): string {
  return value
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/]]>$/i, "")
    .trim();
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];

  // Extract all <item> blocks
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  for (const item of itemMatches) {
    const rawLink = extractTag(item, "link") ?? extractTag(item, "guid");
    const url = rawLink ? stripCdata(rawLink).trim() : null;

    const rawTitle = extractTag(item, "title") ?? "Untitled";
    const headline = decodeEntities(stripCdata(rawTitle));

    const rawBody =
      extractCdata(item, "description") ??
      extractTag(item, "description") ??
      extractTag(item, "content:encoded") ??
      "";
    const body = decodeEntities(stripCdata(rawBody));

    const image_url =
      extractAttr(item, "media:content", "url") ??
      extractAttr(item, "media:thumbnail", "url") ??
      extractEnclosureUrl(item) ??
      extractFirstImageSrcFromHtml(rawBody) ??
      null;

    const rawPublished =
      extractTag(item, "pubDate") ?? extractTag(item, "dc:date") ?? null;
    const published_at = rawPublished ? stripCdata(rawPublished) : null;

    if (url && headline) {
      items.push({
        url: url.trim(),
        headline,
        body: stripHtml(body),
        image_url,
        published_at,
      });
    }
  }

  return items.slice(0, 20); // max 20 per fetch to stay cost-efficient
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractCdata(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`, "i");
  return xml.match(re)?.[1] ?? null;
}

function extractEnclosureUrl(xml: string): string | null {
  // Match <enclosure> where type starts with "image" and capture url, regardless of attribute order
  const re1 = /<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i;
  const re2 = /<enclosure[^>]*url="([^"]+)"[^>]*type="image[^"]*"/i;
  const m = xml.match(re1) ?? xml.match(re2);
  return m?.[1] ?? null;
}

function extractFirstImageSrcFromHtml(html: string): string | null {
  const match = html.match(/<img[^>]+src="([^"]+)"/i);
  return match?.[1] ?? null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ─── STAGE 1 CONTENT FILTER (BUILD 2D) ────────────────────────────────────────

function isOlderThanHours(published_at: string | null, now: Date, hours: number) {
  if (!published_at) return false;
  const d = new Date(published_at);
  if (isNaN(d.getTime())) return false;
  const diffMs = now.getTime() - d.getTime();
  return diffMs > hours * 60 * 60 * 1000;
}

function failsStageOneFilters(item: RssItem, now: Date): boolean {
  const body = item.body.trim();
  const headline = item.headline.trim();
  const lowerBody = body.toLowerCase();
  const lowerHeadline = headline.toLowerCase();

  // R1: min body length (stubs, captions, tickers)
  if (body.length < 80) return true;

  // R2: max age 48h (archive resurfaces)
  if (isOlderThanHours(item.published_at, now, 48)) return true;

  // R3: non-editorial patterns (sponsored, horoscope, galleries, live blogs, quizzes)
  const nonEditorialPatterns = [
    "sponsored content",
    "sponsored article",
    "partnered content",
    "advertorial",
    "horoscope",
    "zodiac",
    "astrology",
    "photo gallery",
    "in pics",
    "in pictures",
    "slideshow",
    "live blog",
    "live updates",
    "quiz:",
  ];

  if (
    nonEditorialPatterns.some(
      (p) => lowerHeadline.includes(p) || lowerBody.includes(p)
    )
  ) {
    return true;
  }

  // R4: wire service reposts (PTI/ANI/IANS/Reuters/AFP/AP)
  const upperBody = body.toUpperCase();
  const upperHeadline = headline.toUpperCase();
  const wirePrefixes = ["PTI", "ANI", "IANS", "REUTERS", "AFP", "AP "];
  const isWire = wirePrefixes.some(
    (prefix) =>
      upperBody.startsWith(prefix + " ") ||
      upperBody.startsWith(prefix + ":") ||
      upperHeadline.startsWith(prefix + " ") ||
      upperHeadline.startsWith(prefix + ":")
  );
  if (isWire) return true;

  // R5: zombie articles – no published date at all
  if (!item.published_at) return true;

  return false;
}

// ─── GEMINI SUMMARISATION ─────────────────────────────────────────────────────

async function summariseArticle(
  headline: string,
  body: string,
  language: string
): Promise<string> {
  const langNote =
    language !== "en"
      ? `The article may be in ${language}. Respond in English.`
      : "";

  const prompt = `Summarise this Indian news article in exactly 2–3 sentences. Be factual, neutral, and concise. Capture the key who, what, and why. Do not include opinions or commentary. Return only the summary text, no preamble. ${langNote}

Headline: ${headline}

Article: ${body.slice(0, 2000)}`; // cap body to keep token cost low

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

async function tagTopics(
  headline: string,
  summary: string
): Promise<string[]> {
  const TOPICS = [
    "politics",
    "economy",
    "judiciary",
    "foreign-policy",
    "environment",
    "science-tech",
    "health",
    "sports",
    "education",
    "society",
    "business",
    "defence",
  ];

  const prompt = `Given this Indian news headline and summary, return a JSON array of 1–3 topic tags from this list: ${TOPICS.join(", ")}.
Return ONLY valid JSON, e.g. ["politics","economy"]. No explanation.

Headline: ${headline}
Summary: ${summary}`;

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 60 },
    }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

  try {
    const tags = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return Array.isArray(tags) ? tags.filter((t: string) => TOPICS.includes(t)) : [];
  } catch {
    return [];
  }
}

// ─── CLASSIFICATION (BUILD 3) ─────────────────────────────────────────────────

interface ClassifierOutput {
  identity_score: number | null;
  state_trust_score: number | null;
  economic_score: number | null;
  institution_score: number | null;
  rationale: {
    identity: string;
    state_trust: string;
    economic: string;
    institution: string;
  };
  unclassifiable: boolean;
}

const CLASSIFIER_PROMPT_TEMPLATE = `You are classifying an Indian news article across four editorial stance axes. 
This is NOT about the events reported, but about HOW the outlet frames them.

Score each axis from 0.0 to 1.0. Scores should be granular (e.g. 0.3, 0.65, 0.8) — avoid clustering at 0.5.
If the article is genuinely neutral on an axis, use 0.5. Reserve 0.5 only for true neutrality.

AXES:

1. identity_score
   0.0 = Frames all groups with equal weight, avoids majoritarian assumptions, uses neutral/plural language
   1.0 = Frames issues primarily through a majority-community lens, minority groups treated as "other" or secondary
   Example 0.2: Article on communal tension uses equal quotes from both communities, avoids loaded terms
   Example 0.8: Same event described with language that implicitly centres Hindu nationalist framing

2. state_trust_score
   0.0 = Treats government claims with editorial scepticism, seeks independent verification, highlights opposition views
   1.0 = Reproduces government statements as fact without challenge, minimal opposition or expert counter-voice
   Example 0.1: Article on GDP growth questions methodology, cites independent economists
   Example 0.9: Article on GDP growth reprints ministry press release with no additional voices

3. economic_score
   0.0 = Centres welfare impact, redistribution, labour rights, or inequality in framing economic stories
   1.0 = Centres GDP growth, investor confidence, ease of doing business, market efficiency
   Example 0.2: Coverage of a factory closure focuses on workers displaced, community impact
   Example 0.8: Same story focuses on impact to sector FDI and government ease-of-business ranking

4. institution_score
   0.0 = Critical or questioning stance toward courts, RBI, Election Commission, press institutions
   1.0 = Deferential toward institutional decisions, treats institutional authority as legitimate and final. Use scores above 0.7 when the article praises these institutions, highlights their wisdom or integrity, or frames criticism as fringe/unreasonable.
   Example 0.2: Article on Supreme Court verdict notes criticism from legal scholars
   Example 0.9: Article on same verdict treats it as settled and authoritative, no critical voices

IMPORTANT:
- Score the framing and editorial choices, NOT the facts reported
- Many articles will be genuinely neutral on some axes — 0.5 is valid when warranted
- Short or purely factual articles with no evident framing should return null for all scores
- Articles that are motivational quotes, celebrity lifestyle, sports recaps, entertainment gossip, or non-political human-interest pieces should be treated as not political and marked unclassifiable.
- Return ONLY valid JSON, no explanation, no markdown

Headline: {{headline}}
Summary: {{summary}}
Body (first 1500 chars): {{body}}

Return this JSON and nothing else:
{
  "identity_score": 0.0,
  "state_trust_score": 0.0,
  "economic_score": 0.0,
  "institution_score": 0.0,
  "rationale": {
    "identity": "one sentence",
    "state_trust": "one sentence",
    "economic": "one sentence",
    "institution": "one sentence"
  },
  "unclassifiable": false
}

If the article is too short, purely factual, sports, celebrity, lifestyle, motivational quote, entertainment, or other non-political human-interest with no political or institutional framing,
set "unclassifiable": true and all scores to null.`;

async function classifyArticle(
  headline: string,
  summary: string,
  body: string
): Promise<ClassifierOutput> {
  const prompt = CLASSIFIER_PROMPT_TEMPLATE
    .replace("{{headline}}", headline)
    .replace("{{summary}}", summary)
    .replace("{{body}}", body.slice(0, 1500));

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 400 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini classify error: ${err}`);
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  if (!raw) {
    throw new Error("Empty classifier response");
  }

  let parsed: any;
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse classifier JSON: ${(e as Error).message}`);
  }

  const unclassifiable = parsed.unclassifiable === true;

  const output: ClassifierOutput = {
    identity_score: unclassifiable ? null : parsed.identity_score ?? null,
    state_trust_score: unclassifiable ? null : parsed.state_trust_score ?? null,
    economic_score: unclassifiable ? null : parsed.economic_score ?? null,
    institution_score: unclassifiable ? null : parsed.institution_score ?? null,
    rationale: {
      identity: parsed.rationale?.identity ?? "",
      state_trust: parsed.rationale?.state_trust ?? "",
      economic: parsed.rationale?.economic ?? "",
      institution: parsed.rationale?.institution ?? "",
    },
    unclassifiable,
  };

  return output;
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

async function handleIngest(): Promise<Response> {
  const results = { processed: 0, inserted: 0, skipped: 0, errors: 0 };
  const now = new Date();

  try {
    // Fetch all active sources
    const { data: sources, error: sourcesErr } = await supabase
      .from("sources")
      .select("id, name, rss_url, language, active")
      .eq("active", true);

    if (sourcesErr) throw sourcesErr;
    if (!sources?.length) {
      return Response.json({ message: "No active sources configured", results });
    }

    for (const source of sources) {
      try {
        console.log(`Fetching: ${source.name}`);
        const items = await fetchRssFeed(source.rss_url);

        for (const item of items) {
          results.processed++;

          // Stage 1 content filter (R1–R5)
          if (failsStageOneFilters(item, now)) {
            results.skipped++;
            continue;
          }

          // Check if article already exists
          const { data: existing } = await supabase
            .from("articles")
            .select("id")
            .eq("url", item.url)
            .maybeSingle();

          if (existing) {
            results.skipped++;
            continue;
          }

          // Only summarise if we have enough body text
          let summary = "";
          let topic_tags: string[] = [];

          if (item.body.length > 100 || item.headline.length > 20) {
            try {
              summary = await summariseArticle(
                item.headline,
                item.body,
                (source as any).language ?? "en"
              );
              if (summary) {
                topic_tags = await tagTopics(item.headline, summary);
              }
            } catch (geminiErr) {
              console.error(`Gemini error for ${item.url}:`, geminiErr);
              // Insert without summary rather than failing the whole article
            }
          }

          let published_at: string | null = null;
          if (item.published_at) {
            const d = new Date(item.published_at);
            if (!isNaN(d.getTime())) {
              published_at = d.toISOString();
            }
          }

          const { error: insertErr } = await supabase.from("articles").insert({
            source_id: (source as any).id,
            url: item.url,
            headline: item.headline,
            body: item.body.slice(0, 8000), // cap stored body
            summary,
            image_url: item.image_url,
            published_at,
            topic_tags,
          });

          if (insertErr) {
            // Unique constraint violation = already exists, safe to skip
            if ((insertErr as any).code === "23505") {
              results.skipped++;
            } else {
              console.error("Insert error:", insertErr);
              results.errors++;
            }
          } else {
            results.inserted++;
          }

          // Small delay to avoid hammering Gemini
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (sourceErr) {
        console.error(`Error processing source ${(source as any).name}:`, sourceErr);
        results.errors++;
      }
    }
  } catch (err) {
    console.error("Fatal error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }

  console.log("Ingest complete:", results);
  return Response.json({ results, timestamp: new Date().toISOString() });
}

async function handleClassify(): Promise<Response> {
  const batchSize = 30;
  const now = new Date();

  const summary: any = {
    requested: batchSize,
    processed: 0,
    classified: 0,
    unclassifiable: 0,
    errors: 0,
  };

  try {
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, source_id, headline, summary, body, published_at")
      .is("identity_score", null)
      .not("summary", "is", null)
      .neq("summary", "")
      .order("ingested_at", { ascending: true })
      .limit(batchSize);

    if (error) throw error;
    if (!articles || articles.length === 0) {
      return Response.json({
        message: "No articles pending classification",
        summary,
      });
    }

    for (const article of articles) {
      summary.processed++;
      try {
        const output = await classifyArticle(
          (article as any).headline,
          (article as any).summary,
          (article as any).body ?? ""
        );

        const { error: updateErr } = await supabase
          .from("articles")
          .update({
            identity_score: output.identity_score,
            state_trust_score: output.state_trust_score,
            economic_score: output.economic_score,
            institution_score: output.institution_score,
            classifier_rationale: output,
          })
          .eq("id", (article as any).id);

        if (updateErr) {
          console.error("Update error:", updateErr);
          summary.errors++;
        } else {
          if (output.unclassifiable) {
            summary.unclassifiable++;
          } else {
            summary.classified++;
          }
        }
      } catch (e) {
        console.error("Classification error:", e);
        summary.errors++;
      }

      // Slight delay to avoid hammering Gemini
      await new Promise((r) => setTimeout(r, 500));
    }

    // Refresh source_ideology_scores aggregation
    try {
      await supabase.rpc("refresh_source_ideology_scores");
    } catch (aggErr) {
      console.error("Aggregation error:", aggErr);
    }
  } catch (err) {
    console.error("Fatal classify error:", err);
    return Response.json({ error: String(err) }, { status: 500, summary });
  }

  return Response.json({ summary, timestamp: now.toISOString() });
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const phase = url.searchParams.get("phase") ?? "ingest";

  if (phase === "ingest") return handleIngest();
  if (phase === "classify") return handleClassify();

  return Response.json({ error: "Unknown phase" }, { status: 400 });
});
