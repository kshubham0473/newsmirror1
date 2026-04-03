# NewsMirror — Ops Runbook

> Last updated: April 2026
> Owner: Backend / Infra

This runbook covers the three automated pipelines that keep NewsMirror running. When a `🚨` alert issue is opened automatically by a failed GitHub Actions workflow, start here.

---

## Architecture at a glance

```
GitHub Actions (cron)
  ├── ingest.yml       every 30 min   → ?phase=ingest
  ├── classify.yml     every 2 hours  → ?phase=classify
  └── summarise.yml    manual-only    → (no phase param)
                          ↓
         Supabase Edge Function: ingest-articles
                          ↓
              Supabase Postgres DB
                  articles table
                  source_ideology_scores table
```

---

## Secret dependencies

| Secret name | Where it is used | How to rotate |
|---|---|---|
| `SUPABASE_URL` | All 3 workflows | Update in GitHub → Settings → Secrets → Actions |
| `SUPABASE_SERVICE_ROLE_KEY` | All 3 workflows | Rotate in Supabase → Project Settings → API → Service role key, then update GitHub secret |
| `GEMINI_API_KEY` | Edge Function (set in Supabase secrets) | Rotate in Google AI Studio, then update in Supabase → Edge Functions → Secrets |

---

## Pipeline 1: Ingest (`ingest.yml`)

**Schedule:** every 30 minutes (`*/30 * * * *`)
**What it does:** Calls `?phase=ingest` — fetches RSS feeds, deduplicates, inserts new rows into `articles`.

### Triage steps

1. **Open the failed run** — link is in the alert issue body.
2. **Check the curl output** — the workflow prints the HTTP status and the raw JSON response from the Edge Function. A 401 means a bad/missing service role key. A 500 means an Edge Function crash.
3. **Check Edge Function logs** — Supabase dashboard → Edge Functions → `ingest-articles` → Logs. Filter by time of failure.
4. **Common causes and fixes:**

| Symptom | Likely cause | Fix |
|---|---|---|
| HTTP 401 | `SUPABASE_SERVICE_ROLE_KEY` missing or rotated | Re-add the secret in GitHub Settings |
| HTTP 500, "no sources found" | `sources` table is empty or all sources set inactive | Add at least one active source row |
| HTTP 500, RSS fetch error | Source URL is down or changed | Check the URL manually; update the source row |
| HTTP 200 but 0 articles inserted | All items already exist (dedup working) | Not a real failure; close the alert |
| Workflow times out | Edge Function exceeded 150s wall clock | Check if too many sources are configured; reduce or paginate |

5. **Manual re-trigger:** Go to Actions → NewsMirror ingest → Run workflow.

---

## Pipeline 2: Classify (`classify.yml`)

**Schedule:** every 2 hours (`0 */2 * * *`)
**What it does:** Calls `?phase=classify` — picks up to 10 unclassified articles (with summaries), sends each to Gemini 2.5 Flash Lite, writes 4-axis scores + rationale back to `articles`, then re-aggregates `source_ideology_scores`.

### Triage steps

1. **Open the failed run** — link is in the alert issue body.
2. **Check the curl output** — HTTP status + Edge Function response JSON (includes count of processed/errors).
3. **Check Edge Function logs** — Supabase → Edge Functions → `ingest-articles` → Logs.
4. **Check Gemini quota** — Google AI Studio → API usage dashboard. Free tier has per-minute and per-day limits.
5. **Common causes and fixes:**

| Symptom | Likely cause | Fix |
|---|---|---|
| HTTP 500, Gemini 429 | Gemini rate limit hit | Wait for quota reset; optionally reduce batch size via env var |
| HTTP 500, Gemini 401 | `GEMINI_API_KEY` missing or expired | Re-add in Supabase → Edge Functions → Secrets |
| HTTP 200 but `classified: 0` | No articles with summaries and null scores | Backlog may be clear; run summarise manually first |
| Scores all null, `unclassifiable: true` | Articles are short/non-political (expected) | Not a failure; inspect a sample to confirm |
| Aggregation step fails | `source_ideology_scores` unique constraint missing | Run Gate 1 DB migration: `ALTER TABLE source_ideology_scores ADD CONSTRAINT ... UNIQUE (source_id)` |

6. **Manual re-trigger:** Actions → NewsMirror classify → Run workflow.
7. **Backfill mode:** To clear the backlog faster, temporarily increase batch size — set `CLASSIFY_BATCH_SIZE=20` in Supabase Edge Function secrets, then reduce back to 10 after backfill.

---

## Pipeline 3: Summarise (`summarise.yml`)

**Schedule:** Manual-only (no cron). Trigger when you have a batch of articles with no summary.
**What it does:** Calls the Edge Function without a phase param — runs the summarise + tag step on unsummarised articles.

### Triage steps

Same as Classify above. Most common failure mode is a Gemini API key issue.

---

## Database health checks

Run these queries in Supabase SQL editor to check pipeline health:

```sql
-- Total articles and classification coverage
SELECT
  COUNT(*) AS total,
  COUNT(summary) AS with_summary,
  COUNT(identity_score) AS classified,
  COUNT(*) - COUNT(identity_score) AS pending_classification
FROM articles;

-- Sources with enough articles for a profile (>=10 in last 90 days)
SELECT s.name, COUNT(a.id) AS article_count
FROM sources s
JOIN articles a ON a.source_id = s.id
WHERE a.published_at > NOW() - INTERVAL '90 days'
  AND a.identity_score IS NOT NULL
GROUP BY s.name
HAVING COUNT(a.id) >= 10
ORDER BY article_count DESC;

-- Recent aggregation state
SELECT source_id, article_count, updated_at
FROM source_ideology_scores
ORDER BY updated_at DESC
LIMIT 20;

-- Articles stuck without a summary (should be 0 after a summarise run)
SELECT COUNT(*) AS unsummarised
FROM articles
WHERE summary IS NULL OR summary = '';
```

---

## Alert issue labels

All auto-created alert issues carry two labels: `ops` and `alert`. To see all active alerts:

```
https://github.com/kshubham0473/newsmirror1/issues?q=is%3Aissue+is%3Aopen+label%3Aops
```

Close the issue once the root cause is fixed and a subsequent pipeline run succeeds.

---

## Escalation

| Situation | Action |
|---|---|
| Ingest down for > 2 hours | Check Supabase status page (status.supabase.com) for platform incidents |
| Gemini down | Monitor Google AI status; all classification runs will fail until resolved — close the alert issues and re-trigger manually once restored |
| DB schema drift | Check recent migrations in `supabase/migrations/`; re-run missing ones via Supabase CLI or dashboard |
