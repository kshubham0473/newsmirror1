#!/usr/bin/env node
/**
 * backfill-pipeline.mjs — clear the pipeline backlog in one go.
 *
 * Calls the ingest-articles Edge Function phase-by-phase in a loop,
 * exactly like the GitHub Actions workflows do, but back-to-back
 * until each backlog is empty.
 *
 * Usage:
 *   node scripts/backfill-pipeline.mjs                 # summarise + embed + cluster
 *   node scripts/backfill-pipeline.mjs --with-classify # also classify (costs more)
 *   node scripts/backfill-pipeline.mjs --with-framing  # also profile-sources + analyze-clusters
 *
 * Env (reads .env.local automatically):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety:
 *   - 3s pause between calls (Gemini free-tier RPM headroom)
 *   - stops a phase when it reports 0 processed twice in a row
 *   - hard cap of 40 calls per phase (~600 summaries) per run
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── load .env.local ──
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in .env.local)");
  process.exit(1);
}
const FN = `${URL_BASE}/functions/v1/ingest-articles`;

const withClassify = process.argv.includes("--with-classify");
const withFraming  = process.argv.includes("--with-framing");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callPhase(phase) {
  const res = await fetch(`${FN}?phase=${phase}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: res.status, json, text };
}

// How many items a phase reports as processed — used to detect an empty backlog.
// The edge function nests counts under `results` (most phases) or `summary` (classify),
// and returns a top-level `message` when there is nothing left to do.
function processedCount(json) {
  if (!json) return 0;
  if (json.message) return 0; // e.g. "No articles pending summarisation"
  const r = json.results ?? json.summary ?? json;
  return r.processed ?? r.summarised ?? r.embedded ?? r.classified ?? r.inserted ?? r.clustered ?? 0;
}

async function runPhase(phase, maxCalls = 40) {
  console.log(`\n━━ ${phase} ━━`);
  let emptyStreak = 0;
  for (let i = 1; i <= maxCalls; i++) {
    const t0 = Date.now();
    let r;
    try { r = await callPhase(phase); }
    catch (e) { console.error(`  #${i} network error: ${e.message} — retrying in 10s`); await sleep(10000); continue; }

    const n = processedCount(r.json);
    const errs = (r.json?.results ?? r.json?.summary ?? {}).errors ?? 0;
    console.log(`  #${i} HTTP ${r.status} · processed=${n} · errors=${errs} · ${((Date.now()-t0)/1000).toFixed(1)}s ${r.json ? "· " + JSON.stringify(r.json).slice(0, 160) : ""}`);
    if (r.json?.message) { console.log(`  ${r.json.message} — done.`); return; }

    if (r.status === 429 || (r.text && r.text.includes("429"))) {
      console.log("  Gemini rate limit — waiting 60s");
      await sleep(60000);
      continue;
    }
    if (r.status >= 500) { console.log("  server error — waiting 15s"); await sleep(15000); continue; }

    emptyStreak = n === 0 ? emptyStreak + 1 : 0;
    if (emptyStreak >= 2) { console.log(`  backlog clear for ${phase}.`); return; }
    await sleep(3000);
  }
  console.log(`  reached ${maxCalls}-call cap for ${phase} (re-run to continue).`);
}

console.log(`Target: ${FN}`);
console.log(`Phases: ingest, summarise, embed, cluster${withClassify ? ", classify" : ""}${withFraming ? ", profile-sources, analyze-clusters" : ""}`);

await runPhase("ingest", 8);          // a few extra source slots
await runPhase("summarise", 60);      // 15/call, also embeds — blocks everything downstream
await runPhase("embed");              // catches any embed stragglers
if (withClassify) await runPhase("classify"); // 10/call — most expensive per article
await runPhase("cluster", 2);         // full pass, cheap (no Gemini)
if (withFraming) {
  await runPhase("profile-sources", 3);
  await runPhase("analyze-clusters", 5);
}

console.log("\nDone. Check counts with the SQL in docs/ops-runbook.md → Database health checks.");
