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
): Promise<{ summary: string; tags: string[]; entities: string[]; entityTypes: Record<string, string> }> {
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

ENTITIES rules — 2 to 6 canonical entities this article is ABOUT (not passing mentions),
each with a type from: person, org, place, party, policy, scheme, event, case, bill, project, controversy.
Use the common canonical form and be consistent — always "BJP" not "Bharatiya Janata Party",
always "E20 ethanol" not "20% ethanol blend". Keep proper capitalisation.

Return ONLY valid JSON, no markdown fences, in this shape:
{"summary": "…", "tags": ["politics", "economy"], "entities": [{"name": "E20 ethanol", "type": "policy"}, {"name": "Nitin Gadkari", "type": "person"}]}

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
  if (!raw) return { summary: "", tags: [], entities: [], entityTypes: {} };

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: string) => TOPIC_LIST.includes(t)).slice(0, 3)
      : [];
    const { entities, entityTypes } = parseEntityList(parsed.entities);
    return { summary, tags, entities, entityTypes };
  } catch {
    // Model ignored the JSON instruction — salvage the text as a summary
    console.error("summariseAndTag: non-JSON response, salvaging as plain summary");
    return { summary: raw.slice(0, 800), tags: [], entities: [], entityTypes: {} };
  }
}

/** Accepts both typed objects [{name,type}] and legacy plain strings. */
function parseEntityList(rawList: unknown): { entities: string[]; entityTypes: Record<string, string> } {
  const entities: string[] = [];
  const entityTypes: Record<string, string> = {};
  if (Array.isArray(rawList)) {
    for (const item of rawList.slice(0, 6)) {
      if (typeof item === "string" && item.trim().length > 1 && item.trim().length < 60) {
        entities.push(item.trim());
      } else if (item && typeof item === "object" && typeof (item as any).name === "string") {
        const name = (item as any).name.trim();
        if (name.length > 1 && name.length < 60) {
          entities.push(name);
          if (typeof (item as any).type === "string") entityTypes[name] = (item as any).type.toLowerCase().trim();
        }
      }
    }
  }
  return { entities, entityTypes };
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
        const { summary, tags, entities, entityTypes } = await summariseAndTag(
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
            .update({ summary, topic_tags: tags, key_entities: entities, entity_types: entityTypes, entities_extracted_at: new Date().toISOString() })
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

// ─── HANDLER: BACKFILL ENTITIES ───────────────────────────────────────────────
//
// One-time bootstrap so Thread detection has data before the crons slowly build
// it. Extracts entities from the EXISTING summary (short prompt, cheap) for
// political articles that were summarised before entity extraction shipped.
// Rate-limit-aware, same pacing as summarise. Safe to re-run.

async function extractEntitiesOnly(
  headline: string,
  summary: string
): Promise<{ entities: string[]; entityTypes: Record<string, string> }> {
  const prompt = `From this Indian news headline and summary, list 2–6 canonical entities the story is ABOUT (not passing mentions), each with a type from: person, org, place, party, policy, scheme, event, case, bill, project, controversy. Use consistent canonical forms (e.g. "BJP" not "Bharatiya Janata Party", "E20 ethanol" not "20% ethanol blend"). Keep proper capitalisation.

Return ONLY valid JSON: {"entities": [{"name": "E20 ethanol", "type": "policy"}, {"name": "Nitin Gadkari", "type": "person"}]}

Headline: ${headline}
Summary: ${summary}`;

  let raw = "";
  if (GROQ_API_KEY) raw = await groqJson(prompt, 160);
  else raw = await geminiJson(prompt, 160);
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return parseEntityList(parsed.entities);
  } catch { return { entities: [], entityTypes: {} }; }
}

async function handleBackfillEntities(): Promise<Response> {
  const BATCH_SIZE = 15;
  const DELAY_MS = 2200;
  const results = { processed: 0, updated: 0, errors: 0, rate_limited: false };

  try {
    const sinceIso = new Date(Date.now() - 10 * 864e5).toISOString();
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, headline, summary")
      .overlaps("topic_tags", POLITICAL_TAGS)
      .not("summary", "is", null)
      .neq("summary", "")
      // Attempted-flag, not entity-presence — so empty-entity articles aren't
      // re-picked forever (the classifier-loop trap).
      .is("entities_extracted_at", null)
      .gte("ingested_at", sinceIso)
      .order("ingested_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No political articles pending entity backfill", results });
    }

    for (const a of articles as any[]) {
      results.processed++;
      try {
        const { entities, entityTypes } = await extractEntitiesOnly(a.headline, a.summary);
        const { error: uErr } = await supabase
          .from("articles")
          .update({ key_entities: entities, entity_types: entityTypes, entities_extracted_at: new Date().toISOString() })
          .eq("id", a.id);
        if (uErr) { console.error("entity backfill update error:", uErr); results.errors++; }
        else results.updated++;
      } catch (e) {
        const m = String(e);
        console.error("entity backfill error:", m);
        results.errors++;
        if (m.includes("429") || m.toLowerCase().includes("rate")) { results.rate_limited = true; break; }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } catch (err) {
    console.error("Fatal backfill-entities error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: TYPE ENTITIES ───────────────────────────────────────────────────
//
// Types UNIQUE entity strings (not articles): ~60 per LLM call into a permanent
// entity_directory. One-time cost ≈ corpus_unique/60 calls; then a tiny daily
// top-up for new entities. The directory types every past and future occurrence,
// and is the seed of a canonical entity registry.

async function handleTypeEntities(): Promise<Response> {
  const PER_CALL = 60;
  const MAX_CALLS = 6; // per invocation; script loops until "nothing pending"
  const results = { unique_pending: 0, typed: 0, calls: 0, errors: 0, rate_limited: false };

  try {
    // Distinct entities in the recent window not yet in the directory
    const sinceIso = new Date(Date.now() - 21 * 864e5).toISOString();
    const { data: rows, error } = await supabase.rpc("pending_entities", { p_since: sinceIso, p_limit: PER_CALL * MAX_CALLS });
    if (error) throw error;
    const pending: { key: string; display: string }[] = (rows ?? []) as any[];
    results.unique_pending = pending.length;
    if (!pending.length) {
      return Response.json({ message: "No entities pending typing", results });
    }

    for (let i = 0; i < pending.length; i += PER_CALL) {
      const batch = pending.slice(i, i + PER_CALL);
      results.calls++;
      const listing = batch.map((e, n) => `${n + 1}. ${e.display}`).join("\n");
      const prompt = `Classify each Indian-news entity below into exactly one type from:
person, org, place, party, policy, scheme, event, case, bill, project, controversy, other.
"party" = political party. Government bodies, courts, companies, media = "org".
Policies/rollouts like "E20 ethanol" = "policy". Probes/trials = "case".

Return ONLY valid JSON mapping each number to a type, e.g. {"1": "person", "2": "policy"}

Entities:
${listing}`;

      try {
        const raw = GROQ_API_KEY ? await groqJson(prompt, 700) : await geminiJson(prompt, 700);
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        const upserts = batch.map((e, n) => ({
          entity_key: e.key,
          display: e.display,
          entity_type: typeof parsed[String(n + 1)] === "string" ? parsed[String(n + 1)].toLowerCase().trim() : "other",
        }));
        const { error: uErr } = await supabase.from("entity_directory").upsert(upserts, { onConflict: "entity_key" });
        if (uErr) { console.error("[type-entities] upsert error:", uErr); results.errors++; }
        else results.typed += upserts.length;
      } catch (e) {
        const m = String(e);
        console.error("[type-entities] batch error:", m.slice(0, 200));
        results.errors++;
        if (m.includes("429") || m.toLowerCase().includes("rate")) { results.rate_limited = true; break; }
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  } catch (err) {
    console.error("Fatal type-entities error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: DETECT THREADS ──────────────────────────────────────────────────
//
// Phase 2 of Threads. NO LLM — pure entity heuristic, so it costs nothing to run.
//
// An "issue" is an entity that keeps generating coverage: it appears in political
// articles across ≥ MIN_DAYS distinct days with ≥ MIN_ARTICLES articles in a
// rolling window. Each qualifying entity anchors a Thread; its articles attach.
//
// Fragmentation guard: entities are processed most-articles-first, and once an
// article is claimed by a Thread it can't seed another — so "E20 ethanol",
// "sugar mills", and "Nitin Gadkari" (which co-occur in the same articles)
// collapse into ONE thread instead of three. Co-occurring entities are recorded
// as the thread's related key_entities.

const THREAD_WINDOW_DAYS  = parseInt(Deno.env.get("THREAD_WINDOW_DAYS")  ?? "14");
const THREAD_MIN_DAYS     = parseInt(Deno.env.get("THREAD_MIN_DAYS")     ?? "3");
const THREAD_MIN_ARTICLES = parseInt(Deno.env.get("THREAD_MIN_ARTICLES") ?? "5");
const THREAD_MIN_SOURCES  = parseInt(Deno.env.get("THREAD_MIN_SOURCES")  ?? "3");
// An entity present in more than this share of the corpus is a participant,
// not an issue (measured: Gadkari 21%, India 13% vs E20 8.9%).
const THREAD_MAX_DF = parseFloat(Deno.env.get("THREAD_MAX_DF") ?? "0.12");

// Structurally generic entities — never anchors (still allowed as related).
// Lowercased; matched against normalized keys.
const ANCHOR_STOPLIST = new Set([
  "india", "bharat", "us", "usa", "united states", "china", "pakistan", "russia",
  "centre", "center", "central government", "indian government", "government of india",
  "government", "state government", "parliament", "lok sabha", "rajya sabha",
  "supreme court", "high court", "election commission",
  "bjp", "congress", "aap", "trinamool congress", "tmc", "nda", "india bloc",
  "delhi", "new delhi", "mumbai", "bengaluru", "kolkata", "chennai", "hyderabad", "pune",
  "uttar pradesh", "maharashtra", "west bengal", "tamil nadu", "karnataka", "kerala",
  "gujarat", "rajasthan", "bihar", "madhya pradesh", "punjab", "haryana", "odisha",
  "jammu and kashmir", "assam", "telangana", "andhra pradesh",
]);

// Indian-news synonym folding applied inside normalization
const ENTITY_SYNONYMS: [RegExp, string][] = [
  [/\bmandir\b/g, "temple"],
  [/\bgovt\b/g, "government"],
  [/\bshri\b/g, ""],
];

// Entity types that may anchor a thread (when typed data is available).
// Issues are things that happen or get decided — never people/places/orgs.
const ANCHOR_TYPES = new Set(["policy", "event", "scheme", "case", "bill", "project", "controversy"]);

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_ENTITY_RE = new RegExp(`^(?:(?:${MONTHS})\\.?\\s*\\d{1,2}|\\d{1,2}\\s*(?:${MONTHS})|\\d{4})$`, "i");

/** Normalize an entity to a grouping key. Display form is chosen separately. */
function normalizeEntity(e: string): string {
  let k = e.toLowerCase().trim();
  if (DATE_ENTITY_RE.test(k)) return "";        // dates are not entities ("July 9")
  k = k.replace(/\s*\([^)]*\)\s*/g, " ");      // strip parentheticals: "SIR (electoral rolls)"
  k = k.replace(/['’]s\b/g, "");                // possessives
  for (const [re, sub] of ENTITY_SYNONYMS) k = k.replace(re, sub);
  k = k.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (DATE_ENTITY_RE.test(k)) return "";
  return k;
}

function tokens(k: string): Set<string> {
  return new Set(k.split(" ").filter((t) => t.length > 2));
}

async function handleDetectThreads(): Promise<Response> {
  const results = {
    corpus: 0, candidates: 0, stoplisted: 0, too_generic: 0, type_blocked: 0,
    alias_merges: 0, threads_upserted: 0, articles_linked: 0, errors: 0,
  };

  try {
    const sinceIso = new Date(Date.now() - THREAD_WINDOW_DAYS * 864e5).toISOString();

    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, source_id, published_at, ingested_at, key_entities, entity_types")
      .overlaps("topic_tags", POLITICAL_TAGS)
      .not("key_entities", "is", null)
      .gte("ingested_at", sinceIso)
      .order("ingested_at", { ascending: false })
      .limit(2000);

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No recent political articles with entities", results });
    }
    results.corpus = articles.length;

    // Entity directory: types for unique entity strings (lower(surface form) → type)
    const dirMap = new Map<string, string>();
    const { data: dirRows } = await supabase.from("entity_directory").select("entity_key, entity_type").limit(10000);
    for (const d of (dirRows ?? []) as any[]) dirMap.set(d.entity_key, d.entity_type);

    // ── Build normalized entity index ──
    // key -> stats + surface-form counts + type votes
    interface Ent { arts: Set<string>; days: Set<string>; srcs: Set<string>; forms: Map<string, number>; types: Map<string, number>; }
    const idx = new Map<string, Ent>();
    const artKeys = new Map<string, Set<string>>();
    const artDate = new Map<string, string>();
    const artSrc = new Map<string, string>();

    for (const a of articles as any[]) {
      const ents: string[] = Array.isArray(a.key_entities) ? a.key_entities : [];
      if (!ents.length) continue;
      const day = (a.published_at ?? a.ingested_at ?? "").slice(0, 10);
      artDate.set(a.id, a.published_at ?? a.ingested_at);
      artSrc.set(a.id, a.source_id);
      const keys = new Set<string>();
      for (const e of ents) {
        const k = normalizeEntity(e);
        if (!k) continue;
        keys.add(k);
        if (!idx.has(k)) idx.set(k, { arts: new Set(), days: new Set(), srcs: new Set(), forms: new Map(), types: new Map() });
        const r = idx.get(k)!;
        r.arts.add(a.id);
        if (day) r.days.add(day);
        if (a.source_id) r.srcs.add(a.source_id);
        r.forms.set(e, (r.forms.get(e) ?? 0) + 1);
        const t = a.entity_types?.[e];
        if (typeof t === "string") r.types.set(t, (r.types.get(t) ?? 0) + 1);
      }
      artKeys.set(a.id, keys);
    }

    // ── Alias merge: token-subset containment ──
    // "ram temple" absorbs "ayodhya ram temple", "ram temple trust", etc.
    // Merge child (superset key, fewer articles) into parent (subset key, more articles).
    const keysBySize = [...idx.keys()].sort((a, b) => idx.get(b)!.arts.size - idx.get(a)!.arts.size);
    const aliasOf = new Map<string, string>();
    for (let i = 0; i < keysBySize.length; i++) {
      const parent = keysBySize[i];
      if (aliasOf.has(parent)) continue;
      const pTok = tokens(parent);
      // Single-token parents ("temple", "police") are too generic to absorb
      // specific children — that's how "temple" once swallowed "ram temple".
      if (pTok.size < 2) continue;
      for (let j = i + 1; j < keysBySize.length; j++) {
        const child = keysBySize[j];
        if (aliasOf.has(child)) continue;
        const cTok = tokens(child);
        if (cTok.size <= pTok.size) continue; // child must be the longer/more-specific form
        let contained = true;
        for (const t of pTok) if (!cTok.has(t)) { contained = false; break; }
        if (contained) {
          aliasOf.set(child, parent);
          const p = idx.get(parent)!, c = idx.get(child)!;
          c.arts.forEach((x) => p.arts.add(x));
          c.days.forEach((x) => p.days.add(x));
          c.srcs.forEach((x) => p.srcs.add(x));
          c.forms.forEach((n, f) => p.forms.set(f, (p.forms.get(f) ?? 0) + n));
          c.types.forEach((n, t) => p.types.set(t, (p.types.get(t) ?? 0) + n));
          results.alias_merges++;
        }
      }
    }
    for (const child of aliasOf.keys()) idx.delete(child);
    // Remap per-article keys through aliases
    for (const keys of artKeys.values()) {
      for (const k of [...keys]) {
        const root = aliasOf.get(k);
        if (root) { keys.delete(k); keys.add(root); }
      }
    }

    // Type resolution for any entity group: per-article votes, then directory.
    const resolveType = (r: Ent): string | null => {
      if (r.types.size > 0) return [...r.types.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const votes = new Map<string, number>();
      for (const [form, n] of r.forms.entries()) {
        const t = dirMap.get(form.toLowerCase().trim());
        if (t) votes.set(t, (votes.get(t) ?? 0) + n);
      }
      return votes.size > 0 ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
    };

    // ── Anchor eligibility ──
    const corpusSize = results.corpus;
    const qualifying: [string, Ent][] = [];
    for (const [k, r] of idx.entries()) {
      if (r.days.size < THREAD_MIN_DAYS || r.arts.size < THREAD_MIN_ARTICLES || r.srcs.size < THREAD_MIN_SOURCES) continue;
      if (ANCHOR_STOPLIST.has(k)) { results.stoplisted++; continue; }
      if (r.arts.size / corpusSize > THREAD_MAX_DF) { results.too_generic++; continue; }

      // Participant-typed candidates (person/org/place/party) stay in the pool —
      // their issue-evidence check happens at CLAIM time, over the articles they
      // would actually own after bigger issue-threads have claimed theirs.
      // (Checking earlier let "Narendra Modi" borrow evidence from E20 articles
      // that E20 then claimed away, leaving a junk thread.)
      qualifying.push([k, r]);
    }
    // Issue-typed anchors claim first (within each tier: by persistence×volume) —
    // a diffuse participant thread must never steal articles from a real issue.
    const tierOf = (r: Ent) => {
      const t = resolveType(r);
      return t && ANCHOR_TYPES.has(t) ? 0 : 1;
    };
    qualifying.sort((a, b) => {
      const tier = tierOf(a[1]) - tierOf(b[1]);
      if (tier !== 0) return tier;
      return (b[1].days.size * b[1].arts.size) - (a[1].days.size * a[1].arts.size);
    });
    results.candidates = qualifying.length;

    const claimed = new Set<string>();
    const runStart = new Date().toISOString();

    for (const [key, r] of qualifying) {
      const own = [...r.arts].filter((id) => !claimed.has(id));
      if (own.length < THREAD_MIN_ARTICLES) continue;
      const ownSrcs = new Set(own.map((id) => artSrc.get(id)).filter(Boolean));
      if (ownSrcs.size < THREAD_MIN_SOURCES) continue;

      // Issue-evidence gate for participant-typed anchors, evaluated over the
      // articles this thread would ACTUALLY own: an issue-typed co-entity must
      // appear in ≥25% of them (min 3). "Iran"+ceasefire passes; "Modi" over
      // leftover diffuse coverage and "police" over unrelated crime don't.
      const anchorType = resolveType(r);
      if (anchorType && !ANCHOR_TYPES.has(anchorType)) {
        const coCount = new Map<string, number>();
        for (const id of own) {
          for (const k2 of artKeys.get(id) ?? []) {
            if (k2 === key) continue;
            coCount.set(k2, (coCount.get(k2) ?? 0) + 1);
          }
        }
        let evidence = false;
        for (const [k2, c] of coCount.entries()) {
          if (c < Math.max(3, own.length * 0.25)) continue;
          const g2 = idx.get(k2);
          const t2 = g2 ? resolveType(g2) : null;
          if (t2 && ANCHOR_TYPES.has(t2)) { evidence = true; break; }
        }
        if (!evidence) { results.type_blocked++; continue; }
      }

      // Display form = most frequent raw surface form
      const display = [...r.forms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;

      // Related entities via co-occurrence ≥30% (display forms of their keys)
      const coCount = new Map<string, number>();
      for (const id of own) {
        for (const k2 of artKeys.get(id) ?? []) {
          if (k2 === key) continue;
          coCount.set(k2, (coCount.get(k2) ?? 0) + 1);
        }
      }
      const related = [...coCount.entries()]
        .filter(([, c]) => c >= own.length * 0.3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k2]) => {
          const f = idx.get(k2)?.forms;
          return f ? [...f.entries()].sort((a, b) => b[1] - a[1])[0][0] : k2;
        });

      const dates = own.map((id) => artDate.get(id)).filter(Boolean).sort();
      const last = dates[dates.length - 1] ?? null;

      try {
        // Status is NOT written here: new rows default to 'candidate' (awaiting
        // the curator), and existing rows keep their curated/rejected status.
        // Detection only refreshes facts; the curator owns judgment.
        const { data: thread, error: tErr } = await supabase
          .from("threads")
          .upsert({
            anchor_key: key,
            anchor_entity: display,
            key_entities: [display, ...related],
            article_count: own.length,
            source_count: ownSrcs.size,
            first_seen: dates[0] ?? null,
            last_article_at: last,
            updated_at: runStart,
          }, { onConflict: "anchor_key" })
          .select("id")
          .single();

        if (tErr || !thread) { console.error("[threads] upsert error:", tErr); results.errors++; continue; }
        results.threads_upserted++;

        const rows = own.map((article_id) => ({ thread_id: thread.id, article_id }));
        const { error: linkErr } = await supabase
          .from("thread_articles")
          .upsert(rows, { onConflict: "thread_id,article_id" });
        if (linkErr) { console.error("[threads] link error:", linkErr); results.errors++; }
        else results.articles_linked += rows.length;

        own.forEach((id) => claimed.add(id));
      } catch (e) {
        console.error(`[threads] anchor "${key}" error:`, e);
        results.errors++;
      }
    }

    // Lifecycle maintenance (never touches 'rejected'):
    // stale threads (not refreshed this run) → dormant
    await supabase.from("threads").update({ status: "dormant" })
      .lt("updated_at", runStart).neq("status", "rejected");
    // curated + fresh coverage → developing / steady
    const d3 = new Date(Date.now() - 3 * 864e5).toISOString();
    const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
    await supabase.from("threads").update({ status: "developing" })
      .gte("updated_at", runStart).not("curated_at", "is", null)
      .neq("status", "rejected").gte("last_article_at", d3);
    await supabase.from("threads").update({ status: "steady" })
      .gte("updated_at", runStart).not("curated_at", "is", null)
      .neq("status", "rejected").gte("last_article_at", d7).lt("last_article_at", d3);
  } catch (err) {
    console.error("Fatal detect-threads error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: CURATE THREADS ──────────────────────────────────────────────────
//
// The judgment layer: heuristic detection generates candidates (recall);
// ONE Groq-70B call per run curates them (precision) — keeps genuine ongoing
// national issues, rejects diffuse participant clouds, merges duplicates,
// writes neutral human titles. Runs after detect-threads, once daily.

async function handleCurateThreads(): Promise<Response> {
  const results = { candidates: 0, kept: 0, rejected: 0, merged: 0, errors: 0, rate_limited: false };

  try {
    const { data: cands, error } = await supabase
      .from("threads")
      .select("id, anchor_key, anchor_entity, key_entities, article_count, source_count, first_seen, last_article_at")
      .eq("status", "candidate")
      .order("article_count", { ascending: false })
      .limit(20);

    if (error) throw error;
    if (!cands?.length) {
      return Response.json({ message: "No candidate threads pending curation", results });
    }
    results.candidates = cands.length;

    // Sample headlines give the curator real content to judge
    const samples = new Map<string, string[]>();
    for (const c of cands as any[]) {
      const { data: arts } = await supabase
        .from("thread_articles")
        .select("articles(headline)")
        .eq("thread_id", c.id)
        .limit(5);
      samples.set(c.id, (arts ?? []).map((r: any) => r.articles?.headline).filter(Boolean));
    }

    const listing = (cands as any[]).map((c, i) => {
      const days = c.first_seen && c.last_article_at
        ? Math.max(1, Math.round((new Date(c.last_article_at).getTime() - new Date(c.first_seen).getTime()) / 864e5))
        : 1;
      return `${i + 1}. anchor: "${c.anchor_entity}" | entities: ${(c.key_entities ?? []).join(", ")} | ${c.article_count} articles, ${c.source_count} sources, ~${days} days
   sample headlines: ${(samples.get(c.id) ?? []).map((h: string) => `"${h.slice(0, 90)}"`).join(" · ")}`;
    }).join("\n\n");

    const prompt = `You curate "Threads" for an Indian news app: durable, ongoing NATIONAL issues that readers follow over days/weeks to form an informed opinion (policy debates, major probes, geopolitical crises, significant controversies).

Below are machine-detected candidates. For each, decide:
- "keep"   — a genuine ongoing issue. Give it a neutral, specific, human title (≤60 chars) that names the ISSUE, not a person (e.g. "Ram Mandir treasury theft probe", not "SIT").
- "drop"   — not an issue: diffuse clouds around a generic entity (e.g. unrelated crime stories sharing "police"), entertainment/sports promo, market noise, one-off events with no ongoing arc.
- "merge"  — same underlying issue as another candidate; give the target number and one title.

Titles must be strictly neutral and descriptive — never take a side.

Return ONLY valid JSON:
{"decisions": [{"n": 1, "action": "keep", "title": "..."}, {"n": 2, "action": "drop"}, {"n": 3, "action": "merge", "into": 1, "title": "..."}]}

Candidates:
${listing}`;

    let raw = "";
    try {
      raw = GROQ_API_KEY ? await groqJson(prompt, 900, GROQ_MODEL_SMART) : await geminiJson(prompt, 900);
    } catch (e) {
      const m = String(e);
      if (m.includes("429") || m.toLowerCase().includes("rate")) {
        results.rate_limited = true;
        return Response.json({ message: "Curator rate-limited; retry shortly", results });
      }
      throw e;
    }

    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const decisions: any[] = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    const byN = (n: number) => (cands as any[])[n - 1];
    const now = new Date().toISOString();
    const d3 = new Date(Date.now() - 3 * 864e5).toISOString();

    // Apply merges first so targets exist before keeps finalize
    for (const d of decisions.filter((x) => x.action === "merge")) {
      const src = byN(d.n); const tgt = byN(d.into);
      if (!src || !tgt || src.id === tgt.id) continue;
      try {
        const { data: links } = await supabase.from("thread_articles").select("article_id").eq("thread_id", src.id);
        if (links?.length) {
          await supabase.from("thread_articles").upsert(
            (links as any[]).map((l) => ({ thread_id: tgt.id, article_id: l.article_id })),
            { onConflict: "thread_id,article_id" }
          );
        }
        await supabase.from("threads").update({
          status: "rejected", curated_at: now, curator_note: `merged into ${tgt.anchor_entity}`,
        }).eq("id", src.id);
        if (typeof d.title === "string" && d.title.trim()) {
          await supabase.from("threads").update({ title: d.title.trim().slice(0, 80) }).eq("id", tgt.id);
        }
        results.merged++;
      } catch (e) { console.error("[curate] merge error:", e); results.errors++; }
    }

    for (const d of decisions.filter((x) => x.action === "keep" || x.action === "drop")) {
      const t = byN(d.n);
      if (!t) continue;
      try {
        if (d.action === "drop") {
          await supabase.from("threads").update({
            status: "rejected", curated_at: now, curator_note: "curator: not an ongoing issue",
          }).eq("id", t.id);
          results.rejected++;
        } else {
          const status = t.last_article_at && t.last_article_at >= d3 ? "developing" : "steady";
          await supabase.from("threads").update({
            status, curated_at: now,
            title: typeof d.title === "string" && d.title.trim() ? d.title.trim().slice(0, 80) : t.anchor_entity,
          }).eq("id", t.id);
          results.kept++;
        }
      } catch (e) { console.error("[curate] apply error:", e); results.errors++; }
    }
  } catch (err) {
    console.error("Fatal curate-threads error:", err);
    return Response.json({ error: String(err), results }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: SYNTHESIZE THREADS ──────────────────────────────────────────────
//
// Phase 3: the living brief. For each curated active thread whose coverage has
// moved since its last synthesis, ONE Groq-70B call produces:
//   - "where it stands" (descriptive, ~100 words)
//   - "the sides" (how outlet groups frame it — cited, never adjudicated)
//   - new time-spine beats since the last synthesis
// Also computes spectrum_spread (source ideology positions) — no LLM needed.
// ~4–6 calls/day at current thread counts.

async function handleSynthesizeThreads(): Promise<Response> {
  const MAX_THREADS = 6;
  const results = { examined: 0, synthesized: 0, beats_added: 0, skipped_fresh: 0, errors: 0, rate_limited: false };

  try {
    const { data: threads, error } = await supabase
      .from("threads")
      .select("id, title, anchor_entity, key_entities, article_count, first_seen, last_article_at, synthesis, synthesis_updated_at")
      .in("status", ["developing", "steady"])
      .not("curated_at", "is", null)
      .order("last_article_at", { ascending: false })
      .limit(MAX_THREADS * 2);

    if (error) throw error;
    if (!threads?.length) return Response.json({ message: "No active curated threads", results });

    // Source ideology lookup for spectrum spread
    const { data: sis } = await supabase
      .from("source_ideology_scores")
      .select("source_id, identity_score, state_trust_score, economic_score, institution_score");
    const srcPos = new Map<string, number>();
    for (const r of (sis ?? []) as any[]) {
      const vals = [r.identity_score, r.state_trust_score, r.economic_score, r.institution_score]
        .filter((v: any) => typeof v === "number" && v > 0);
      if (vals.length) srcPos.set(r.source_id, vals.reduce((s: number, v: number) => s + v, 0) / vals.length);
    }

    let processed = 0;
    for (const t of threads as any[]) {
      if (processed >= MAX_THREADS) break;
      results.examined++;

      // Skip if nothing new since last synthesis
      if (t.synthesis_updated_at && t.last_article_at && t.synthesis_updated_at >= t.last_article_at) {
        results.skipped_fresh++;
        continue;
      }
      processed++;

      try {
        // Thread articles with source + date, newest first
        const { data: links } = await supabase
          .from("thread_articles")
          .select("articles(id, headline, summary, published_at, ingested_at, source_id, sources(name))")
          .eq("thread_id", t.id)
          .limit(60);
        const arts = ((links ?? []) as any[])
          .map((l) => l.articles).filter((a) => a?.summary)
          .sort((a, b) => (b.published_at ?? b.ingested_at ?? "").localeCompare(a.published_at ?? a.ingested_at ?? ""));
        if (arts.length < 3) continue;

        // Spectrum spread: distinct source positions (no LLM)
        const spreadSet = new Map<string, number>();
        for (const a of arts) {
          const p = srcPos.get(a.source_id);
          if (typeof p === "number") spreadSet.set(a.source_id, p);
        }
        const spectrum_spread = [...spreadSet.values()].sort((a, b) => a - b).map((v) => Math.round(v * 100) / 100);

        // Existing beats (avoid duplicates)
        const { data: beats } = await supabase
          .from("thread_beats")
          .select("beat_date, headline")
          .eq("thread_id", t.id)
          .order("beat_date", { ascending: false })
          .limit(15);
        const existingBeats = ((beats ?? []) as any[])
          .map((b) => `${b.beat_date}: ${b.headline}`).join("\n") || "(none yet)";

        const artBlock = arts.slice(0, 35).map((a) => {
          const d = (a.published_at ?? a.ingested_at ?? "").slice(0, 10);
          return `[${d}] ${a.sources?.name ?? "?"}: "${a.headline}" — ${String(a.summary).slice(0, 180)}`;
        }).join("\n");

        const prompt = `You maintain a strictly NEUTRAL, DESCRIPTIVE brief on an ongoing Indian news issue for a perspective-comparison app. You NEVER take a side, judge who is right, or use loaded language. You describe what happened and how different outlets frame it.

ISSUE: ${t.title}
Coverage: ${arts.length} articles, ${t.first_seen?.slice(0, 10)} → ${t.last_article_at?.slice(0, 10)}

PREVIOUS SYNTHESIS (may be outdated):
${t.synthesis ? JSON.stringify(t.synthesis).slice(0, 900) : "(first synthesis)"}

EXISTING TIMELINE BEATS (do NOT repeat these):
${existingBeats}

ARTICLES (newest first, with source and date):
${artBlock}

Produce ONLY valid JSON:
{
  "where_it_stands": "90-120 words: what has factually happened and where the issue currently stands. Neutral prose, no opinions, no 'should'.",
  "sides": [
    {"label": "3-6 word framing label", "outlets": ["exact outlet names"], "emphasis": "one sentence: what this group's coverage emphasises"}
  ],
  "new_beats": [
    {"date": "YYYY-MM-DD", "headline": "short factual milestone headline", "what_happened": "1-2 sentences, factual"}
  ]
}

Rules: 2-3 sides max, grouped by genuinely different framing (cite only outlets present above). new_beats = significant developments NOT already in the existing beats, one per date at most, oldest allowed date ${t.first_seen?.slice(0, 10)}. If nothing genuinely new, new_beats may be empty.`;

        let raw = "";
        try {
          raw = GROQ_API_KEY ? await groqJson(prompt, 900, GROQ_MODEL_SMART) : await geminiJson(prompt, 900);
        } catch (e) {
          const m = String(e);
          results.errors++;
          if (m.includes("429") || m.toLowerCase().includes("rate")) { results.rate_limited = true; break; }
          continue;
        }

        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        const synthesis = {
          where_it_stands: typeof parsed.where_it_stands === "string" ? parsed.where_it_stands.trim() : null,
          sides: Array.isArray(parsed.sides)
            ? parsed.sides.slice(0, 3).map((s: any) => ({
                label: String(s.label ?? "").slice(0, 60),
                outlets: Array.isArray(s.outlets) ? s.outlets.slice(0, 6).map((o: any) => String(o)) : [],
                emphasis: String(s.emphasis ?? "").slice(0, 240),
              }))
            : [],
        };
        if (!synthesis.where_it_stands) { results.errors++; continue; }

        const now = new Date().toISOString();
        const { error: uErr } = await supabase.from("threads").update({
          synthesis, spectrum_spread, synthesis_updated_at: now, updated_at: now,
        }).eq("id", t.id);
        if (uErr) { console.error("[synthesize] update error:", uErr); results.errors++; continue; }
        results.synthesized++;

        const newBeats = (Array.isArray(parsed.new_beats) ? parsed.new_beats : [])
          .filter((b: any) => typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && typeof b.headline === "string")
          .slice(0, 8)
          .map((b: any) => ({
            thread_id: t.id,
            beat_date: b.date,
            headline: String(b.headline).slice(0, 160),
            what_happened: typeof b.what_happened === "string" ? b.what_happened.slice(0, 400) : null,
          }));
        if (newBeats.length) {
          const { error: bErr } = await supabase
            .from("thread_beats")
            .upsert(newBeats, { onConflict: "thread_id,beat_date,headline", ignoreDuplicates: true });
          if (bErr) console.error("[synthesize] beats error:", bErr);
          else results.beats_added += newBeats.length;
        }
      } catch (e) {
        console.error(`[synthesize] thread "${t.title}" error:`, String(e).slice(0, 200));
        results.errors++;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  } catch (err) {
    console.error("Fatal synthesize-threads error:", err);
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
  if (phase === "backfill-entities") return handleBackfillEntities();
  if (phase === "type-entities")    return handleTypeEntities();
  if (phase === "detect-threads")   return handleDetectThreads();
  if (phase === "curate-threads")   return handleCurateThreads();
  if (phase === "synthesize-threads") return handleSynthesizeThreads();

  return Response.json({ error: `Unknown phase: ${phase}` }, { status: 400 });
});
