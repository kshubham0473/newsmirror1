// supabase/functions/ingest-articles/index.ts
// Deploy: supabase functions deploy ingest-articles
//
// Phase routing:
//   ?phase=ingest           — fetch RSS feeds, deduplicate, insert raw articles
//   ?phase=summarise        — summarise + tag unsummarised articles (Gemini, 1 call per article)
//   ?phase=embed            — batch-embed political articles missing embeddings
//   ?phase=classify         — classify articles with summaries (Gemini) [legacy, prefer profile-sources]
//   ?phase=cluster          — cluster articles by embedding similarity (every 6h)
//   ?phase=profile-sources  — classify top political articles per source for ideology profiling (daily)
//   ?phase=analyze-clusters — detect framing divergence across outlets in same cluster (daily)
//
// v40 changes (quota-aware rebuild of the Gemini paths):
//   - summarise: single combined summary+tags call (halves request count),
//     batch 8 with 4s spacing to respect free-tier RPM, aborts batch on 429
//   - embed: uses batchEmbedContents (40 texts per request instead of 40 requests),
//     political articles only — non-political articles never cluster anyway
//   - ingest: decodeEntities now handles &apos; &#39; and smart-quote entities

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const EMBED_BATCH_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";

// Groq — high-throughput free tier (30 RPM / 14,400 RPD on llama-3.1-8b-instant).
// Primary engine for summarise+tag; Gemini remains primary for classify/framing.
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "llama-3.1-8b-instant";
// Judgment tasks (classify, framing) use the 70B — separate 1,000 req/day
// free pool, so they can never be starved by the summariser or by Gemini.
const GROQ_MODEL_SMART = Deno.env.get("GROQ_MODEL_SMART") ?? "llama-3.3-70b-versatile";

// Cosine similarity threshold for clustering — tune via env var without redeployment
const CLUSTER_THRESHOLD = parseFloat(Deno.env.get("CLUSTER_THRESHOLD") ?? "0.82");

const SOURCES_PER_RUN = parseInt(Deno.env.get("INGEST_SOURCES_PER_RUN") ?? "4");

// Sources profiled per invocation of ?phase=profile-sources
// 5 sources × 3 articles × ~3s/classify = ~45s — within the 60s limit
const PROFILE_SOURCES_PER_RUN = parseInt(Deno.env.get("PROFILE_SOURCES_PER_RUN") ?? "5");

// Only these topic tags are diagnostic of editorial stance — sports/lifestyle are noise
const POLITICAL_TAGS = ["politics", "judiciary", "foreign-policy", "defence", "economy", "society"];

const TOPIC_LIST = [
  "politics", "economy", "judiciary", "foreign-policy", "environment",
  "science-tech", "health", "sports", "education", "society", "business", "defence",
];

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
    signal: AbortSignal.timeout(8_000),
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

  return items.slice(0, 20);
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractCdata(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`, "i");
  return xml.match(re)?.[1] ?? null;
}

function extractEnclosureUrl(xml: string): string | null {
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
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ");
}

// ─── STAGE 1 CONTENT FILTER ───────────────────────────────────────────────────

function isOlderThanHours(published_at: string | null, now: Date, hours: number) {
  if (!published_at) return false;
  const d = new Date(published_at);
  if (isNaN(d.getTime())) return false;
  return now.getTime() - d.getTime() > hours * 60 * 60 * 1000;
}

function failsStageOneFilters(item: RssItem, now: Date): boolean {
  const body = item.body.trim();
  const headline = item.headline.trim();
  const lowerBody = body.toLowerCase();
  const lowerHeadline = headline.toLowerCase();

  if (body.length < 80) return true;
  if (isOlderThanHours(item.published_at, now, 48)) return true;
  if (!item.published_at) return true;

  const nonEditorialPatterns = [
    "sponsored content", "sponsored article", "partnered content", "advertorial",
    "horoscope", "zodiac", "astrology", "photo gallery", "in pics", "in pictures",
    "slideshow", "live blog", "live updates", "quiz:",
  ];
  if (nonEditorialPatterns.some((p) => lowerHeadline.includes(p) || lowerBody.includes(p))) {
    return true;
  }

  const upperBody = body.toUpperCase();
  const upperHeadline = headline.toUpperCase();
  const wirePrefixes = ["PTI", "ANI", "IANS", "REUTERS", "AFP", "AP "];
  if (wirePrefixes.some(
    (prefix) =>
      upperBody.startsWith(prefix + " ") || upperBody.startsWith(prefix + ":") ||
      upperHeadline.startsWith(prefix + " ") || upperHeadline.startsWith(prefix + ":")
  )) return true;

  return false;
}

// ─── GEMINI HELPERS ───────────────────────────────────────────────────────────

/** Groq chat call in JSON mode. Throws on API errors (incl. 429). */
async function groqJson(prompt: string, maxTokens: number, model = GROQ_MODEL): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Gemini generateContent call. Throws on API errors (incl. 429). */
async function geminiJson(prompt: string, maxTokens: number, temperature = 0.1): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

/**
 * One LLM call producing BOTH the summary and topic tags.
 * Groq (fast free tier) is primary when a key is configured; Gemini is the
 * fallback — and vice versa if Groq is unavailable.
 * Throws on API errors so the caller can detect 429s and back off.
 */
async function summariseAndTag(
  headline: string,
  body: string,
  language: string
): Promise<{ summary: string; tags: string[]; entities: string[] }> {
  const langNote = language !== "en" ? `The article may be in ${language}. Respond in English regardless.` : "";

  // Entities are extracted in the SAME call as summary+tags — no extra API
  // request, no added rate-limit pressure. They power issue/Thread detection
  // and entity-level feed affinity.
  const prompt = `You are processing an Indian news article. Produce a summary, topic tags, AND key entities in one JSON response.

SUMMARY rules — 80–100 words, written for a reader who will not click through:
1. What happened (core event, specific and concrete)
2. Who is involved and what their role is
3. Why it happened or what caused it
4. Why it matters or what the consequence is
5. What happens next (if known)
- Factual and neutral, plain language, flowing prose, no bullet points.
- If the article is too thin to cover all five points, cover what is available — do not pad.
${langNote}

TAGS rules — 1 to 3 tags from exactly this list: ${TOPIC_LIST.join(", ")}

ENTITIES rules — 2 to 6 canonical names of the specific people, organisations,
places, policies, schemes, or events this article is ABOUT (not passing mentions).
Use the common canonical form (e.g. "Narendra Modi", "Supreme Court", "E20 ethanol",
"Ram Mandir", "RBI"). These identify the ongoing issue, so be consistent — always
"BJP" not "Bharatiya Janata Party", always "E20 ethanol" not "20% ethanol blend".
Lowercase-normalise nothing; keep proper capitalisation.

Return ONLY valid JSON, no markdown fences, in this shape:
{"summary": "…", "tags": ["politics", "economy"], "entities": ["E20 ethanol", "Nitin Gadkari", "sugar mills"]}

Headline: ${headline}

Article: ${body.slice(0, 2000)}`;

  // Groq primary (fast + generous free tier), Gemini fallback — or the
  // reverse when no Groq key is configured. Slightly higher token budget to
  // fit the entities array alongside the summary.
  let raw = "";
  if (GROQ_API_KEY) {
    try {
      raw = await groqJson(prompt, 550);
    } catch (groqErr) {
      console.error("Groq summarise failed, falling back to Gemini:", String(groqErr).slice(0, 160));
      raw = await geminiJson(prompt, 550);
    }
  } else {
    raw = await geminiJson(prompt, 550);
  }
  if (!raw) return { summary: "", tags: [], entities: [] };

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: string) => TOPIC_LIST.includes(t)).slice(0, 3)
      : [];
    const entities = Array.isArray(parsed.entities)
      ? parsed.entities
          .filter((e: unknown) => typeof e === "string" && e.trim().length > 1 && e.trim().length < 60)
          .map((e: string) => e.trim())
          .slice(0, 6)
      : [];
    return { summary, tags, entities };
  } catch {
    // Model ignored the JSON instruction — salvage the text as a summary
    console.error("summariseAndTag: non-JSON response, salvaging as plain summary");
    return { summary: raw.slice(0, 800), tags: [], entities: [] };
  }
}

/**
 * Batch embedding: up to ~40 texts in a SINGLE API request.
 * Free-tier embedding quota is counted per request, so this is the
 * difference between 40 requests and 1.
 * Returns null on failure (caller decides how to handle).
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[] | null> {
  const res = await fetch(`${EMBED_BATCH_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
      })),
    }),
  });
  if (!res.ok) {
    console.error(`Batch embedding error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  const embeddings = data.embeddings;
  if (!Array.isArray(embeddings)) return null;
  return embeddings.map((e: any) => (Array.isArray(e?.values) ? e.values : null));
}

// ─── CLASSIFICATION ───────────────────────────────────────────────────────────

interface ClassifierOutput {
  identity_score: number | null;
  state_trust_score: number | null;
  economic_score: number | null;
  institution_score: number | null;
  rationale: { identity: string; state_trust: string; economic: string; institution: string; };
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

2. state_trust_score
   0.0 = Treats government claims with editorial scepticism, seeks independent verification, highlights opposition views
   1.0 = Reproduces government statements as fact without challenge, minimal opposition or expert counter-voice

3. economic_score
   0.0 = Centres welfare impact, redistribution, labour rights, or inequality in framing economic stories
   1.0 = Centres GDP growth, investor confidence, ease of doing business, market efficiency

4. institution_score
   0.0 = Critical or questioning stance toward courts, RBI, Election Commission, press institutions
   1.0 = Deferential toward institutional decisions, treats institutional authority as legitimate and final.

IMPORTANT:
- Score the framing and editorial choices, NOT the facts reported
- Short or purely factual articles with no evident framing should return null for all scores
- Non-political articles (sports recaps, celebrity, lifestyle, entertainment) should be marked unclassifiable
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

If the article is too short, purely factual, sports, celebrity, lifestyle, or non-political,
set "unclassifiable": true and all scores to null.`;

async function classifyArticle(headline: string, summary: string, body: string): Promise<ClassifierOutput> {
  const prompt = CLASSIFIER_PROMPT_TEMPLATE
    .replace("{{headline}}", headline)
    .replace("{{summary}}", summary)
    .replace("{{body}}", body.slice(0, 1500));

  // Groq 70B primary (own 1k/day pool), Gemini fallback.
  // On a rate limit, re-throw immediately — do NOT fall back per-article,
  // or a saturated minute pounds Gemini into the ground too. The caller
  // catches the 429 and breaks the batch to cool off.
  let raw = "";
  if (GROQ_API_KEY) {
    try {
      raw = await groqJson(prompt, 400, GROQ_MODEL_SMART);
    } catch (groqErr) {
      const m = String(groqErr);
      if (m.includes("429") || m.toLowerCase().includes("rate")) throw groqErr;
      console.error("Groq classify failed (non-rate), falling back to Gemini:", m.slice(0, 160));
      raw = await geminiJson(prompt, 400, 0);
    }
  } else {
    raw = await geminiJson(prompt, 400, 0);
  }
  if (!raw) throw new Error("Empty classifier response");

  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    throw new Error(`Failed to parse classifier JSON: ${(e as Error).message}`);
  }

  const unclassifiable = parsed.unclassifiable === true;
  return {
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
}

// ─── HANDLER: INGEST ──────────────────────────────────────────────────────────

async function handleIngest(): Promise<Response> {
  const results = { processed: 0, inserted: 0, skipped: 0, errors: 0, sources_this_run: 0 };
  const now = new Date();

  try {
    const { data: allSources, error: sourcesErr } = await supabase
      .from("sources")
      .select("id, name, rss_url, language, active")
      .eq("active", true)
      .order("id", { ascending: true });

    if (sourcesErr) throw sourcesErr;
    if (!allSources?.length) {
      return Response.json({ message: "No active sources configured", results });
    }

    const slotIndex = Math.floor(now.getTime() / (30 * 60 * 1000));
    const offset = (slotIndex * SOURCES_PER_RUN) % allSources.length;
    const sources = [
      ...allSources.slice(offset, offset + SOURCES_PER_RUN),
      ...allSources.slice(0, Math.max(0, offset + SOURCES_PER_RUN - allSources.length)),
    ].slice(0, SOURCES_PER_RUN);

    results.sources_this_run = sources.length;

    for (const source of sources) {
      try {
        const items = await fetchRssFeed((source as any).rss_url);
        const candidateUrls = items
          .filter((item) => !failsStageOneFilters(item, now))
          .map((item) => item.url);

        let existingUrls = new Set<string>();
        if (candidateUrls.length > 0) {
          const { data: existing } = await supabase
            .from("articles")
            .select("url")
            .in("url", candidateUrls);
          existingUrls = new Set((existing ?? []).map((r: any) => r.url));
        }

        for (const item of items) {
          results.processed++;
          if (failsStageOneFilters(item, now)) { results.skipped++; continue; }
          if (existingUrls.has(item.url)) { results.skipped++; continue; }

          let published_at: string | null = null;
          if (item.published_at) {
            const d = new Date(item.published_at);
            if (!isNaN(d.getTime())) published_at = d.toISOString();
          }

          const { error: insertErr } = await supabase.from("articles").insert({
            source_id: (source as any).id,
            url: item.url,
            headline: item.headline,
            body: item.body.slice(0, 8000),
            summary: "",
            image_url: item.image_url,
            published_at,
            topic_tags: [],
          });

          if (insertErr) {
            if ((insertErr as any).code === "23505") { results.skipped++; }
            else { console.error("Insert error:", insertErr); results.errors++; }
          } else {
            results.inserted++;
          }
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

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: SUMMARISE ───────────────────────────────────────────────────────
//
// Quota-aware: one combined summarise+tag Gemini call per article, batch of 8,
// 4s spacing (~15 requests/min — free-tier RPM ceiling). On the first 429 the
// batch aborts and reports rate_limited so callers back off instead of burning
// the rest of the batch into guaranteed failures.

async function handleSummarise(): Promise<Response> {
  // Groq free tier allows 30 RPM — 15 articles at 2s spacing ≈ 45s/run.
  // Without Groq, drop to Gemini's free-tier pace (8 articles, 4s spacing).
  const BATCH_SIZE = GROQ_API_KEY ? 15 : 8;
  const DELAY_MS = GROQ_API_KEY ? 2000 : 4000;
  const results = { processed: 0, summarised: 0, errors: 0, rate_limited: false, engine: GROQ_API_KEY ? "groq" : "gemini" };

  try {
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, headline, body, source_id")
      .or("summary.is.null,summary.eq.")
      // Newest first — today's articles appear in the feed immediately
      .order("ingested_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No articles pending summarisation", results });
    }

    const sourceIds = [...new Set(articles.map((a: any) => a.source_id))];
    const { data: sources } = await supabase
      .from("sources")
      .select("id, language")
      .in("id", sourceIds);
    const langMap = Object.fromEntries((sources ?? []).map((s: any) => [s.id, s.language ?? "en"]));

    for (const article of articles) {
      results.processed++;
      try {
        const language = langMap[(article as any).source_id] ?? "en";
        const { summary, tags, entities } = await summariseAndTag(
          (article as any).headline,
          (article as any).body ?? "",
          language
        );

        if (!summary) {
          console.error(`Empty summary for article ${(article as any).id}`);
          results.errors++;
        } else {
          const { error: updateErr } = await supabase
            .from("articles")
            .update({ summary, topic_tags: tags, key_entities: entities })
            .eq("id", (article as any).id);

          if (updateErr) {
            console.error("Update error:", updateErr);
            results.errors++;
          } else {
            results.summarised++;
          }
        }
      } catch (e) {
        const msg = String(e);
        console.error("Summarise error:", msg);
        results.errors++;
        if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
          // Rate limited — every further call this minute will also fail.
          // Abort; the remaining articles are picked up by the next run.
          results.rate_limited = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } catch (err) {
    console.error("Fatal summarise error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: EMBED ───────────────────────────────────────────────────────────
//
// Batch embedding of POLITICAL articles only:
//   - batchEmbedContents packs up to 40 texts into ONE API request — free-tier
//     embedding quota is per-request, so this is a ~40× quota saving
//   - non-political articles (sports, lifestyle) never produce meaningful story
//     clusters; embedding them wasted quota and created noise clusters

async function handleEmbed(): Promise<Response> {
  const BATCH_SIZE = 40;
  const results = { processed: 0, embedded: 0, errors: 0, rate_limited: false };

  try {
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, headline, summary")
      .not("summary", "is", null)
      .neq("summary", "")
      .neq("summary", "[skipped]")
      .is("embedding", null)
      .overlaps("topic_tags", POLITICAL_TAGS)
      .order("ingested_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No political articles pending embedding", results });
    }

    results.processed = articles.length;
    const texts = articles.map((a: any) => `${a.headline}. ${a.summary}`.trim());
    const embeddings = await generateEmbeddingsBatch(texts);

    if (!embeddings) {
      results.rate_limited = true; // most common cause; actual error is in logs
      return Response.json({
        message: "Batch embedding request failed — likely quota; see function logs",
        results,
      });
    }

    for (let i = 0; i < articles.length; i++) {
      const embedding = embeddings[i];
      if (!embedding) { results.errors++; continue; }
      const { error: updateErr } = await supabase
        .from("articles")
        .update({ embedding })
        .eq("id", (articles[i] as any).id);
      if (updateErr) {
        console.error("Embed update error:", updateErr);
        results.errors++;
      } else {
        results.embedded++;
      }
    }
  } catch (err) {
    console.error("Fatal embed error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: CLASSIFY ────────────────────────────────────────────────────────

async function handleClassify(): Promise<Response> {
  const BATCH_SIZE = 10;
  const DELAY_MS = 4000; // free-tier RPM pacing, same reasoning as summarise
  const now = new Date();
  const summary: any = { requested: BATCH_SIZE, processed: 0, classified: 0, unclassifiable: 0, errors: 0, rate_limited: false };

  try {
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, source_id, headline, summary, body, published_at")
      .is("identity_score", null)
      // Unclassifiable articles keep NULL scores but DO get a rationale —
      // without this filter they're re-picked forever (the historic
      // "articles getting skipped" bug: the head of the queue loops).
      .is("classifier_rationale", null)
      .not("summary", "is", null)
      .neq("summary", "")
      // Political articles first — the only ones that feed source profiles
      .overlaps("topic_tags", POLITICAL_TAGS)
      .order("ingested_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No articles pending classification", summary });
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
          output.unclassifiable ? summary.unclassifiable++ : summary.classified++;
        }
      } catch (e) {
        const msg = String(e);
        console.error("Classification error:", msg);
        summary.errors++;
        if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
          summary.rate_limited = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    try {
      await supabase.rpc("refresh_source_ideology_scores");
    } catch (aggErr) {
      console.error("Aggregation error:", aggErr);
    }
  } catch (err) {
    console.error("Fatal classify error:", err);
    return Response.json({ error: String(err), summary }, { status: 500 });
  }

  return Response.json({ summary, timestamp: now.toISOString() });
}

// ─── HANDLER: PROFILE SOURCES ────────────────────────────────────────────────
//
// Targeted classification for building high-quality source ideology profiles.
// Picks the most recent unclassified POLITICAL articles from each source —
// only these are diagnostic of editorial stance. Rotates via a daily slot.

async function handleProfileSources(): Promise<Response> {
  const ARTICLES_PER_SOURCE = 3;
  const summary = {
    sources_processed: 0,
    articles_classified: 0,
    unclassifiable: 0,
    errors: 0,
    profiles_refreshed: false,
  };

  try {
    const { data: allSources, error: sourcesErr } = await supabase
      .from("sources")
      .select("id, name")
      .eq("active", true)
      .order("id", { ascending: true });

    if (sourcesErr) throw sourcesErr;
    if (!allSources?.length) return Response.json({ message: "No active sources", summary });

    // Daily slot rotation — different sources profiled each day
    const daySlot = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const offset = (daySlot * PROFILE_SOURCES_PER_RUN) % allSources.length;
    const sources = [
      ...allSources.slice(offset, offset + PROFILE_SOURCES_PER_RUN),
      ...allSources.slice(0, Math.max(0, offset + PROFILE_SOURCES_PER_RUN - allSources.length)),
    ].slice(0, PROFILE_SOURCES_PER_RUN);

    for (const source of sources) {
      summary.sources_processed++;
      try {
        const { data: articles, error: artErr } = await supabase
          .from("articles")
          .select("id, headline, summary, body")
          .eq("source_id", (source as any).id)
          .is("identity_score", null)
          .is("classifier_rationale", null) // skip already-judged unclassifiable
          .not("summary", "is", null)
          .neq("summary", "")
          .overlaps("topic_tags", POLITICAL_TAGS)
          .order("published_at", { ascending: false })
          .limit(ARTICLES_PER_SOURCE);

        if (artErr) { console.error(`[profile] Source ${(source as any).name} fetch error:`, artErr); summary.errors++; continue; }
        if (!articles?.length) {
          console.log(`[profile] No unclassified political articles for ${(source as any).name}`);
          continue;
        }

        for (const article of articles) {
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

            if (updateErr) { console.error("Update error:", updateErr); summary.errors++; }
            else { output.unclassifiable ? summary.unclassifiable++ : summary.articles_classified++; }
          } catch (e) {
            console.error(`[profile] Classify error for article ${(article as any).id}:`, e);
            summary.errors++;
          }
          await new Promise((r) => setTimeout(r, 4000));
        }
      } catch (e) {
        console.error(`[profile] Source ${(source as any).name} error:`, e);
        summary.errors++;
      }
    }

    // Refresh source ideology profiles after classifying new articles
    try {
      await supabase.rpc("refresh_source_ideology_scores");
      summary.profiles_refreshed = true;
    } catch (e) {
      console.error("[profile] refresh_source_ideology_scores error:", e);
    }
  } catch (err) {
    console.error("Fatal profile-sources error:", err);
    return Response.json({ error: String(err), summary }, { status: 500 });
  }

  return Response.json({ summary, timestamp: new Date().toISOString() });
}

// ─── HANDLER: CLUSTER ─────────────────────────────────────────────────────────
//
// Strategy (pgvector-native, no embeddings transferred to Edge Function):
//   1. get_similar_article_pairs() — Postgres computes cosine similarities,
//      returns only (id_a, id_b) pairs above threshold
//   2. Union-find on IDs to group pairs into clusters
//   3. Fetch canonical headline for each cluster root
//   4. Upsert story_clusters and article_clusters rows

async function handleCluster(): Promise<Response> {
  const results = { pairs_found: 0, clusters_created: 0, clusters_updated: 0, articles_assigned: 0, errors: 0 };

  try {
    // 1. Let Postgres find all similar pairs — no embeddings cross the wire
    const { data: pairs, error: pairsErr } = await supabase
      .rpc("get_similar_article_pairs", {
        p_threshold: CLUSTER_THRESHOLD,
        p_window_hours: 72,
      });

    if (pairsErr) throw pairsErr;
    if (!pairs?.length) {
      return Response.json({ message: "No similar pairs found above threshold", results });
    }

    results.pairs_found = pairs.length;
    console.log(`Found ${pairs.length} similar pairs, running union-find...`);

    // 2. Union-find on article IDs
    const idToIdx = new Map<string, number>();
    const allIds: string[] = [];

    for (const pair of pairs) {
      if (!idToIdx.has(pair.article_a)) { idToIdx.set(pair.article_a, allIds.length); allIds.push(pair.article_a); }
      if (!idToIdx.has(pair.article_b)) { idToIdx.set(pair.article_b, allIds.length); allIds.push(pair.article_b); }
    }

    const clusterOf: number[] = allIds.map((_, i) => i);

    function find(i: number): number {
      while (clusterOf[i] !== i) {
        clusterOf[i] = clusterOf[clusterOf[i]];
        i = clusterOf[i];
      }
      return i;
    }

    for (const pair of pairs) {
      const ia = idToIdx.get(pair.article_a)!;
      const ib = idToIdx.get(pair.article_b)!;
      clusterOf[find(ia)] = find(ib);
    }

    // 3. Group by root — only keep groups with 2+ articles
    const groups = new Map<number, string[]>();
    for (let i = 0; i < allIds.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(allIds[i]);
    }
    const multiGroups = Array.from(groups.values()).filter((g) => g.length >= 2);
    console.log(`Union-find produced ${multiGroups.length} clusters`);

    // 4. Fetch headlines for the root article of each group (for canonical_headline)
    const rootIds = multiGroups.map((g) => g[0]);
    const { data: headlines } = await supabase
      .from("articles")
      .select("id, headline")
      .in("id", rootIds);
    const headlineMap = Object.fromEntries((headlines ?? []).map((a: any) => [a.id, a.headline]));

    // 5. Upsert clusters
    for (const articleIds of multiGroups) {
      try {
        const { data: existingAssignments } = await supabase
          .from("article_clusters")
          .select("cluster_id")
          .in("article_id", articleIds)
          .limit(1);

        let clusterId: string;

        if (existingAssignments && existingAssignments.length > 0) {
          clusterId = existingAssignments[0].cluster_id;
          results.clusters_updated++;
        } else {
          const canonicalHeadline = headlineMap[articleIds[0]] ?? "Untitled cluster";
          const { data: newCluster, error: clusterErr } = await supabase
            .from("story_clusters")
            .insert({ canonical_headline: canonicalHeadline })
            .select("id")
            .single();

          if (clusterErr || !newCluster) {
            console.error("Cluster insert error:", clusterErr);
            results.errors++;
            continue;
          }

          clusterId = newCluster.id;
          results.clusters_created++;
        }

        const rows = articleIds.map((article_id) => ({ article_id, cluster_id: clusterId }));
        const { error: acErr } = await supabase
          .from("article_clusters")
          .upsert(rows, { onConflict: "article_id,cluster_id" });

        if (acErr) {
          console.error("article_clusters upsert error:", acErr);
          results.errors++;
        } else {
          results.articles_assigned += rows.length;
        }
      } catch (groupErr) {
        console.error("Group processing error:", groupErr);
        results.errors++;
      }
    }
  } catch (err) {
    console.error("Fatal cluster error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, threshold: CLUSTER_THRESHOLD, timestamp: new Date().toISOString() });
}

// ─── HANDLER: ANALYSE CLUSTERS ───────────────────────────────────────────────
//
// For story clusters covered by 3+ distinct outlets, asks Gemini to compare
// how each outlet framed the event. Stores a prose insight + divergence
// score (0–1) + framing groups.

const FRAMING_PROMPT = `You are an editorial analyst examining how different Indian news outlets framed the same event.

Event: {{canonical_headline}}

Headlines and summaries from {{n}} outlets covering this story:

{{articles}}

Determine if there is meaningful FRAMING divergence — not stylistic differences, but cases where outlets name the story differently, emphasise fundamentally different aspects, or make different editorial choices about what the event is "about".

Classic examples of meaningful divergence:
- One outlet uses the bill's real name; another substitutes a politically charged alternative
- One outlet leads with the government's stated benefit; another leads with the structural consequence
- One outlet frames a vote as "rejection by opposition"; another frames it as "bill fails to pass"

Return ONLY valid JSON, no markdown:
{
  "has_divergence": true,
  "insight": "2-3 sentences describing how the framings diverged, what each emphasises, and what it downplays",
  "divergence_score": 0.75,
  "framing_groups": [
    { "outlets": ["Outlet A", "Outlet B"], "headline": "Representative headline for this framing angle", "slant": "One-phrase characterisation of this framing" },
    { "outlets": ["Outlet C"], "headline": "Representative headline for the contrasting angle", "slant": "One-phrase characterisation" }
  ]
}

framing_groups clusters outlets by shared narrative angle (2–3 groups max). Use the exact outlet names provided in the input.
If all outlets tell essentially the same story, or the topic is non-political, return:
{ "has_divergence": false, "insight": null, "divergence_score": 0.0, "framing_groups": [] }`;

interface FramingGroup {
  outlets: string[];
  headline: string;
  slant?: string;
}

async function analyzeClusterFraming(
  canonicalHeadline: string,
  articles: { headline: string; summary: string; outletName: string }[]
): Promise<{ has_divergence: boolean; insight: string | null; divergence_score: number; framing_groups: FramingGroup[] }> {
  const articleBlock = articles
    .map((a, i) => `Outlet ${i + 1} (${a.outletName}):\nHeadline: ${a.headline}\nSummary: ${a.summary.slice(0, 220)}`)
    .join("\n\n");

  const prompt = FRAMING_PROMPT
    .replace("{{canonical_headline}}", canonicalHeadline)
    .replace("{{n}}", String(articles.length))
    .replace("{{articles}}", articleBlock);

  // Groq 70B primary (own 1k/day pool), Gemini fallback.
  // Re-throw on rate limit so the batch breaks instead of hammering Gemini.
  let raw = "";
  if (GROQ_API_KEY) {
    try {
      raw = await groqJson(prompt, 500, GROQ_MODEL_SMART);
    } catch (groqErr) {
      const m = String(groqErr);
      if (m.includes("429") || m.toLowerCase().includes("rate")) throw groqErr;
      console.error("Groq framing failed (non-rate), falling back to Gemini:", m.slice(0, 160));
      raw = await geminiJson(prompt, 500, 0.1);
    }
  } else {
    raw = await geminiJson(prompt, 500, 0.1);
  }
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      has_divergence: parsed.has_divergence === true,
      insight: parsed.insight ?? null,
      divergence_score: typeof parsed.divergence_score === "number" ? parsed.divergence_score : 0,
      framing_groups: Array.isArray(parsed.framing_groups) ? parsed.framing_groups : [],
    };
  } catch {
    console.error("[analyze] Failed to parse framing JSON:", raw);
    return { has_divergence: false, insight: null, divergence_score: 0, framing_groups: [] };
  }
}

async function handleAnalyzeClusters(): Promise<Response> {
  const MIN_SOURCES = 3;
  const BATCH_SIZE = 8;
  const results = {
    clusters_examined: 0,
    clusters_analyzed: 0,
    divergence_found: 0,
    skipped_too_few_sources: 0,
    errors: 0,
    rate_limited: false,
  };

  try {
    // Over-fetch clusters then filter in JS by distinct source count
    const { data: clusters, error: clustersErr } = await supabase
      .from("story_clusters")
      .select(`
        id, canonical_headline,
        article_clusters ( articles ( id, headline, summary, source_id, sources ( name ) ) )
      `)
      .is("framing_analyzed_at", null)
      .order("created_at", { ascending: false })
      .limit(BATCH_SIZE * 3);

    if (clustersErr) throw clustersErr;
    if (!clusters?.length) return Response.json({ message: "No clusters pending framing analysis", results });

    // Flatten, deduplicate sources, filter to MIN_SOURCES threshold
    const eligible = (clusters as any[])
      .map((cluster) => {
        const articles = (cluster.article_clusters ?? [])
          .flatMap((ac: any) => ac.articles ?? [])
          .filter((a: any) => a.summary && a.summary.trim().length > 10);
        const uniqueSources = new Set(articles.map((a: any) => a.source_id));
        return { ...cluster, _articles: articles, _sourceCount: uniqueSources.size };
      })
      .filter((c) => {
        if (c._sourceCount >= MIN_SOURCES) return true;
        results.skipped_too_few_sources++;
        return false;
      })
      .slice(0, BATCH_SIZE);

    if (!eligible.length) {
      return Response.json({ message: `No clusters with ${MIN_SOURCES}+ sources pending analysis`, results });
    }

    for (const cluster of eligible) {
      results.clusters_examined++;
      try {
        const articleInputs = cluster._articles.map((a: any) => ({
          headline: a.headline,
          summary: a.summary,
          outletName: a.sources?.name ?? `Source ${a.source_id?.slice(0, 6)}`,
        }));

        const analysis = await analyzeClusterFraming(cluster.canonical_headline, articleInputs);

        const { error: updateErr } = await supabase
          .from("story_clusters")
          .update({
            framing_insight: analysis.insight,
            divergence_score: analysis.divergence_score,
            framing_groups: analysis.framing_groups.length > 0 ? analysis.framing_groups : null,
            framing_analyzed_at: new Date().toISOString(),
          })
          .eq("id", cluster.id);

        if (updateErr) {
          console.error("[analyze] Cluster update error:", updateErr);
          results.errors++;
        } else {
          results.clusters_analyzed++;
          if (analysis.has_divergence) {
            results.divergence_found++;
            console.log(`[analyze] Divergence detected in cluster "${cluster.canonical_headline}" — score: ${analysis.divergence_score}`);
          }
        }
      } catch (e) {
        const msg = String(e);
        console.error(`[analyze] Cluster ${cluster.id} error:`, msg);
        results.errors++;
        if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
          results.rate_limited = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  } catch (err) {
    console.error("Fatal analyze-clusters error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: ENRICH IMAGES ───────────────────────────────────────────────────
//
// For articles where image_url is null, fetch the article page and extract
// og:image / twitter:image meta tags. Updates the DB when found.

async function fetchOgImage(articleUrl: string): Promise<string | null> {
  try {
    const res = await fetch(articleUrl, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsMirror/1.0; +https://newsmirror.in)",
        "Accept": "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;

    // Only read first 20 KB — the <head> is always at the top
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = "";
    let bytes = 0;
    while (bytes < 20_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytes += value?.length ?? 0;
      // Stop once we've passed </head>
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    // og:image (preferred)
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]) return ogMatch[1];

    // twitter:image (fallback)
    const twMatch =
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (twMatch?.[1]) return twMatch[1];

    return null;
  } catch {
    return null;
  }
}

async function handleEnrichImages(): Promise<Response> {
  const BATCH_SIZE = 10;
  const results = { processed: 0, enriched: 0, skipped: 0, errors: 0 };

  try {
    // Only process recent articles (last 48h) without images — older ones aren't shown anyway
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, url")
      .is("image_url", null)
      .gte("ingested_at", cutoff)
      .order("ingested_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No articles pending image enrichment", results });
    }

    // Track domains we've already hit this run — one fetch per domain max
    const seenDomains = new Set<string>();

    for (const article of articles) {
      results.processed++;
      try {
        const domain = new URL((article as any).url).hostname;
        if (seenDomains.has(domain)) {
          const domainCount = [...seenDomains].filter((d) => d === domain).length;
          if (domainCount >= 2) { results.skipped++; continue; }
        }
        seenDomains.add(domain);

        const imageUrl = await fetchOgImage((article as any).url);
        if (!imageUrl) { results.skipped++; continue; }

        const { error: updateErr } = await supabase
          .from("articles")
          .update({ image_url: imageUrl })
          .eq("id", (article as any).id);

        if (updateErr) {
          console.error("Image update error:", updateErr);
          results.errors++;
        } else {
          results.enriched++;
        }

        // Polite delay between fetches
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        console.error("Enrich error for article", (article as any).id, e);
        results.errors++;
      }
    }
  } catch (err) {
    console.error("Fatal enrich-images error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const phase = url.searchParams.get("phase") ?? "ingest";

  if (phase === "ingest")           return handleIngest();
  if (phase === "summarise")        return handleSummarise();
  if (phase === "embed")            return handleEmbed();
  if (phase === "classify")         return handleClassify();
  if (phase === "cluster")          return handleCluster();
  if (phase === "profile-sources")  return handleProfileSources();
  if (phase === "analyze-clusters") return handleAnalyzeClusters();
  if (phase === "enrich-images")    return handleEnrichImages();

  return Response.json({ error: `Unknown phase: ${phase}` }, { status: 400 });
});
