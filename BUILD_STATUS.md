# NewsMirror — Build Status & Roadmap
> Last updated: April 17, 2026

---

## Project Stack
- **Frontend:** Next.js 14 (App Router), Vercel
- **Backend:** Supabase (Postgres + Edge Functions + Auth)
- **AI:** Gemini 2.5 Flash Lite (summarise/classify), gemini-embedding-001 768d (embeddings)
- **Repo:** https://github.com/kshubhamk0473/newsmirror1
- **Live:** https://newsmirror1.vercel.app
- **Supabase project ID:** jtnvkrcgzbbuwujaozdk

---

## Current State

| Layer | Status |
|---|---|
| RSS ingest (every 30 min) | ✅ Live |
| Stage 1 content filter | ✅ Live |
| Gemini summarisation — batch 40, newest-first | ✅ Live |
| Gemini embeddings (gemini-embedding-001, 768d) | ✅ Live |
| Topic tagging | ✅ Live |
| 4-axis ideology classifier | ✅ Live — runs every 2h |
| Source ideology profiles (`/sources`) | ✅ Live |
| Google OAuth (Supabase Auth) | ✅ Live |
| Preferences in DB (auto-migrate from localStorage) | ✅ Live |
| Story clustering — average-linkage, threshold 0.88 | ✅ Live — rebuilt Apr 17 |
| Story detail pages (`/story/[id]`) | ✅ Live |
| "N sources covered this" on feed cards | ✅ Live |
| Reading events | ✅ Live — Build 4A |
| Thumbs up/down reactions | ✅ Live — Build 4A |
| Card feed (fan stack, drag-to-dismiss) | ✅ Live |
| List feed | ✅ Live |
| Topic filter bar | ✅ Live |
| Dynamic card stack ordering | ✅ Live — cluster-boost + topic round-robin |
| Admin page (`/admin`) | ✅ Live — gated to admin email only |
| GDELT ingestion | ❌ Rolled back — DOC API rate limits |
| Radar / reader profile | ❌ Not yet — Build 4B |
| Story timelines / topic following | ❌ Not yet — Build 5 |

---

## Active Sources (23)

| Source | Language | Notes |
|---|---|---|
| Times of India | EN | Healthy, high volume |
| NDTV | EN | Healthy |
| The Hindu | EN | Healthy |
| The Hindu BusinessLine | EN | Healthy |
| Mint | EN | Healthy |
| ET Now | EN | Healthy |
| Economic Times | EN | Added Apr 2026 |
| Economic Times Politics | EN | Added Apr 2026 |
| Guardian | EN | International coverage |
| Hindustan Times | EN | Lower volume |
| Scroll | EN | Healthy |
| Inc42 | EN | Startup/tech niche |
| Opindia | EN | Right-lean perspective — intentional |
| India Today | EN | Low ingest rate |
| News18 | EN | Added Apr 2026 |
| Deccan Chronicle | EN | Added Apr 2026 |
| Indian Express | EN | Added Apr 2026 |
| Free Press Journal | EN | Added Apr 2026 |
| NewsBytes | EN | Added Apr 2026 |
| TechCrunch | EN | Added Apr 2026 |
| The Federal | EN | Added Apr 2026, South India focus |
| National Herald | EN | Added Apr 2026, low volume |
| Dainik Bhaskar | HI | Added Apr 2026 — first Hindi source |

---

## GitHub Actions Workflows

| Workflow | Schedule | Phase |
|---|---|---|
| `ingest.yml` | Every 30 min | `?phase=ingest` |
| `summarise.yml` | Every 30 min | `?phase=summarise` |
| `classify.yml` | Every 2h | `?phase=classify` |
| `cluster.yml` | Every 6h | `?phase=cluster` |

**Key GitHub Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CLUSTER_SIMILARITY_THRESHOLD=0.88`, `INGEST_SOURCES_PER_RUN=4`

---

## DB Schema (key tables)

```
articles          — id, source_id, url, headline, body, summary, image_url,
                    published_at, ingested_at, topic_tags, embedding vector(768),
                    identity_score, state_trust_score, economic_score, institution_score

sources           — id, name, home_url, rss_url, language, active

story_clusters    — id, canonical_headline, created_at
article_clusters  — article_id, cluster_id

user_preferences  — user_id, topic_filters, source_filters, onboarding_done
reading_events    — id, user_id, article_id, source_id, read_at, time_spent_seconds
article_reactions — id, user_id, article_id, reaction smallint (1=up, -1=down),
                    reacted_at, UNIQUE(user_id, article_id)
rss_probe_results — source_name (PK), result jsonb, probed_at
```

**Key Postgres function:** `cluster_similar_articles(threshold, days_back)` — average-linkage, updated Apr 17.

---

## RSS Probe Tool

Permanent Edge Function deployed (JWT disabled):
`https://jtnvkrcgzbbuwujaozdk.supabase.co/functions/v1/rss-probe`

Usage: Claude updates the function with candidate URLs via Supabase MCP → you call the URL → share JSON back to Claude.

---

## Build Roadmap

### ✅ Builds 1–3C + UI Sprint + 4A — Complete
Foundation → classifier → auth → embeddings/clustering → UI rebrand → reading events + reactions.

### ✅ UI Fixes (Apr 17)
Image/text split 38/62. Neutral framing label hidden. Reaction active-state scale + colour. Dynamic card ordering. Admin gated to `shubhamk0473@gmail.com`. Admin active/inactive toggle. Dark flash fix.

---

### 🔲 Build 4B — Reader Profile + Radar ← NEXT MAJOR
`/profile` page: 4-axis ideology breakdown, source diversity, topic distribution. Weekly digest, activates at 15+ articles read. Needs a week+ of reading event data first.

**Dependencies:** Build 4A ✅ (data collection running)

---

### 🔲 Build 5 — Story Timelines + Topic Following
Promote clusters into named persistent timelines. `/timeline/[id]` chronological multi-source view. Follow mechanism. Entry via "N sources covered this" pill.

**Dependencies:** Build 3C clustering ✅

---

### 🔲 Build 4C — Freemium
Deferred until radar + timelines live.

---

## Known Issues / Tech Debt

| Issue | Severity | Notes |
|---|---|---|
| Claude chat repo snapshot is stale | High | Always paste current file contents when asking Claude to patch code |
| Cluster window still 10 days | Low | Drop to 72h once article volume stabilises |
| India Today RSS very low (1–3/day) | Low | Monitor |
| New sources (ET, Firstpost, News18, DC) | Low | Verify stable after 48h |
| Next.js security advisory | Low | Upgrade when convenient |
| Admin page has no server-side auth guard | Low | Add Vercel password protection pre-launch |
| pgvector IVFFlat index not created | Low | `CREATE INDEX USING ivfflat` after 1k+ embedded articles |

---

## Feed Quality Algorithm (app/feed/page.tsx)

1. Fetch 200 articles with summary, `published_at DESC`
2. Source cap: max 12 per source
3. Score: `0.65 × age_score + 0.35 × cluster_score` (48h decay)
4. Sort by score, return top 120
5. Client `orderCardStack()`: clustered (3+ sources) every 3rd card, topic round-robin within groups
