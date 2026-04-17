// supabase/functions/ingest-articles/index.ts
// Deploy: supabase functions deploy ingest-articles
//
// Phase routing:
//   ?phase=ingest    — fetch RSS feeds, deduplicate, insert raw articles
//   ?phase=summarise — summarise + tag + embed unsummarised articles (Gemini)
//   ?phase=classify  — classify articles with summaries (Gemini)
//   ?phase=cluster   — cluster articles by embedding similarity (scheduled every 6h)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-005:embedContent";

// Cosine similarity threshold for clustering — tune via env var without redeployment
const CLUSTER_THRESHOLD = parseFloat(Deno.env.get("CLUSTER_THRESHOLD") ?? "0.82");

const SOURCES_PER_RUN = parseInt(Deno.env.get("INGEST_SOURCES_PER_RUN") ?? "4");

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
    .replace(/&#039;/g, "'")
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

async function summariseArticle(headline: string, body: string, language: string): Promise<string> {
  const langNote = language !== "en" ? `The article may be in ${language}. Respond in English regardless.` : "";

  const prompt = `Summarise this Indian news article in 80–100 words. Write for a reader who will not click through to the full story — give them everything they need to understand the event completely.

Structure your summary to cover:
1. What happened (the core event, specific and concrete)
2. Who is involved and what their role is
3. Why it happened or what caused it
4. Why it matters or what the consequence is
5. What happens next (if known from the article)

Rules:
- Be factual and neutral. No opinions or commentary.
- Use plain language. No jargon.
- Write in flowing prose, not bullet points.
- If the article is too thin to cover all five points, cover what is available — do not pad.
- Respond in English regardless of the article's language.
${langNote}

Headline: ${headline}

Article: ${body.slice(0, 2000)}`;

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 350 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

async function tagTopics(headline: string, summary: string): Promise<string[]> {
  const TOPICS = [
    "politics", "economy", "judiciary", "foreign-policy", "environment",
    "science-tech", "health", "sports", "education", "society", "business", "defence",
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

async function generateEmbedding(text: string): Promise<number[] | null> {
  const res = await fetch(`${EMBED_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-005",
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
    }),
  });
  if (!res.ok) {
    console.error(`Embedding error: ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  return data.embedding?.values ?? null;
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

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 400 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini classify error: ${await res.text()}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
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

// ─── COSINE SIMILARITY ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

// ─── HANDLER: SUMMARISE (now also embeds) ─────────────────────────────────────

async function handleSummarise(): Promise<Response> {
  const BATCH_SIZE = 15;
  const results = { processed: 0, summarised: 0, embedded: 0, errors: 0 };

  try {
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, headline, body, source_id")
      .or("summary.is.null,summary.eq.")
      .order("ingested_at", { ascending: true })
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
        const summary = await summariseArticle(
          (article as any).headline,
          (article as any).body ?? "",
          language
        );

        let topic_tags: string[] = [];
        if (summary) {
          topic_tags = await tagTopics((article as any).headline, summary);
        }

        // Generate embedding from headline + summary
        let embedding: number[] | null = null;
        if (summary) {
          const embText = `${(article as any).headline}. ${summary}`.trim();
          embedding = await generateEmbedding(embText);
          if (embedding) results.embedded++;
        }

        const { error: updateErr } = await supabase
          .from("articles")
          .update({ summary, topic_tags, ...(embedding ? { embedding } : {}) })
          .eq("id", (article as any).id);

        if (updateErr) {
          console.error("Update error:", updateErr);
          results.errors++;
        } else {
          results.summarised++;
        }
      } catch (e) {
        console.error("Summarise error:", e);
        results.errors++;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (err) {
    console.error("Fatal summarise error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }

  return Response.json({ results, timestamp: new Date().toISOString() });
}

// ─── HANDLER: CLASSIFY ────────────────────────────────────────────────────────

async function handleClassify(): Promise<Response> {
  const BATCH_SIZE = 10;
  const now = new Date();
  const summary: any = { requested: BATCH_SIZE, processed: 0, classified: 0, unclassifiable: 0, errors: 0 };

  try {
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, source_id, headline, summary, body, published_at")
      .is("identity_score", null)
      .not("summary", "is", null)
      .neq("summary", "")
      .order("ingested_at", { ascending: true })
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
        console.error("Classification error:", e);
        summary.errors++;
      }
      await new Promise((r) => setTimeout(r, 500));
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

// ─── HANDLER: CLUSTER ─────────────────────────────────────────────────────────
//
// Strategy:
//   1. Pull all articles from the last 72h that have an embedding
//   2. For each article not yet in a cluster, compare against all others
//      using cosine similarity
//   3. Group articles above CLUSTER_THRESHOLD into a cluster
//   4. Use single-linkage: an article joins a cluster if it's similar to ANY
//      member already in that cluster
//   5. Upsert story_clusters (keyed on sorted article UUID set to avoid dupes)
//   6. Upsert article_clusters rows
//
// Runs in ~O(n²) — at 72h volume (~500–800 articles) this is fine in an
// Edge Function. Revisit if 72h volume exceeds ~2000 articles.

async function handleCluster(): Promise<Response> {
  const results = { articles_loaded: 0, clusters_created: 0, clusters_updated: 0, articles_assigned: 0, errors: 0 };

  try {
    // 1. Pull recent articles with embeddings
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, headline, source_id, embedding, published_at")
      .not("embedding", "is", null)
      .gte("published_at", cutoff)
      .order("published_at", { ascending: false });

    if (error) throw error;
    if (!articles?.length) {
      return Response.json({ message: "No embedded articles in window", results });
    }

    results.articles_loaded = articles.length;
    console.log(`Clustering ${articles.length} articles...`);

    // 2. Union-find style clustering
    // Each article starts in its own cluster (keyed by index)
    const clusterOf: number[] = articles.map((_, i) => i);

    function find(i: number): number {
      while (clusterOf[i] !== i) {
        clusterOf[i] = clusterOf[clusterOf[i]]; // path compression
        i = clusterOf[i];
      }
      return i;
    }

    function union(i: number, j: number) {
      clusterOf[find(i)] = find(j);
    }

    // 3. Compare all pairs
    for (let i = 0; i < articles.length; i++) {
      for (let j = i + 1; j < articles.length; j++) {
        const sim = cosineSimilarity(
          (articles[i] as any).embedding,
          (articles[j] as any).embedding
        );
        if (sim >= CLUSTER_THRESHOLD) {
          union(i, j);
        }
      }
    }

    // 4. Group by root
    const groups = new Map<number, typeof articles>();
    for (let i = 0; i < articles.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(articles[i]);
    }

    // 5. Only persist clusters with 2+ articles (singletons are not stories)
    const multiSourceGroups = Array.from(groups.values()).filter((g) => g.length >= 2);
    console.log(`Found ${multiSourceGroups.length} clusters with 2+ articles`);

    for (const group of multiSourceGroups) {
      try {
        // Use the most recent article's headline as the canonical headline
        const canonical = group[0] as any;

        // Check if any article in the group is already assigned to a cluster
        const articleIds = group.map((a: any) => a.id);
        const { data: existingAssignments } = await supabase
          .from("article_clusters")
          .select("cluster_id")
          .in("article_id", articleIds)
          .limit(1);

        let clusterId: string;

        if (existingAssignments && existingAssignments.length > 0) {
          // Cluster exists — reuse it
          clusterId = existingAssignments[0].cluster_id;
          results.clusters_updated++;
        } else {
          // New cluster
          const { data: newCluster, error: clusterErr } = await supabase
            .from("story_clusters")
            .insert({ canonical_headline: canonical.headline })
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

        // Upsert article_cluster rows (safe to re-run)
        const rows = articleIds.map((article_id: string) => ({ article_id, cluster_id: clusterId }));
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

// ─── HANDLER: ENRICH IMAGES ───────────────────────────────────────────────────
//
// For articles where image_url is null, fetch the article page and extract
// og:image / twitter:image meta tags. Updates the DB when found.
//
// Safe to run repeatedly — only touches rows where image_url IS NULL.
// Intentionally small batch (10) to stay well within Edge Function time limits.
// One domain is hit at most once per run to avoid rate-limit blocks.

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
          // Space out hits per domain — allow up to 2 per run
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

  if (phase === "ingest")         return handleIngest();
  if (phase === "summarise")      return handleSummarise();
  if (phase === "classify")       return handleClassify();
  if (phase === "cluster")        return handleCluster();
  if (phase === "enrich-images")  return handleEnrichImages();

  return Response.json({ error: `Unknown phase: ${phase}` }, { status: 400 });
});
