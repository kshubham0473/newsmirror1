/**
 * backfill-embeddings.mjs
 * One-off script to generate embeddings for all existing articles.
 *
 * Usage:
 *   node scripts/backfill-embeddings.mjs
 *
 * Requires these env vars (copy from your .env.local or set inline):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← use service role, not anon key
 *   GEMINI_API_KEY
 *
 * Behaviour:
 *   - Fetches articles in pages of 100 where embedding IS NULL
 *   - Calls Gemini text-embedding-005 for each article
 *   - Writes the vector back to articles.embedding
 *   - Throttles to ~200ms between calls to stay within Gemini free-tier rate limits
 *   - Safe to re-run — skips articles that already have an embedding
 *   - Prints a progress line every 50 articles
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  console.error(
    "Missing env vars. Need: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-005:embedContent";

const DELAY_MS = 200;   // between individual API calls
const PAGE_SIZE = 100;  // articles fetched per Supabase query

async function getEmbedding(text) {
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
    const err = await res.text();
    throw new Error(`Gemini embedding error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.embedding?.values ?? null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Starting embedding backfill...");

  let total = 0;
  let succeeded = 0;
  let failed = 0;
  let page = 0;

  while (true) {
    // Fetch a page of articles missing embeddings
    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, headline, summary")
      .is("embedding", null)
      .not("summary", "is", null)
      .neq("summary", "")
      .order("ingested_at", { ascending: true })
      .range(0, PAGE_SIZE - 1); // always from 0 — processed rows get embeddings so they drop out

    if (error) {
      console.error("Supabase fetch error:", error);
      break;
    }

    if (!articles || articles.length === 0) {
      console.log("No more articles to embed.");
      break;
    }

    page++;
    console.log(`\nPage ${page}: processing ${articles.length} articles...`);

    for (const article of articles) {
      total++;
      const text = `${article.headline}. ${article.summary ?? ""}`.trim();

      try {
        const vector = await getEmbedding(text);

        if (!vector) {
          console.warn(`  [${total}] No vector returned for ${article.id}`);
          failed++;
        } else {
          const { error: updateErr } = await supabase
            .from("articles")
            .update({ embedding: vector })
            .eq("id", article.id);

          if (updateErr) {
            console.error(`  [${total}] Update error for ${article.id}:`, updateErr.message);
            failed++;
          } else {
            succeeded++;
            if (succeeded % 50 === 0) {
              console.log(`  ✓ ${succeeded} done, ${failed} failed so far`);
            }
          }
        }
      } catch (e) {
        console.error(`  [${total}] Error for ${article.id}:`, e.message);
        failed++;

        // Back off on rate limit errors
        if (e.message.includes("429")) {
          console.log("  Rate limited — waiting 10s...");
          await sleep(10_000);
        }
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`\nBackfill complete.`);
  console.log(`  Total processed : ${total}`);
  console.log(`  Succeeded       : ${succeeded}`);
  console.log(`  Failed          : ${failed}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
