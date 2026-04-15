# NewsMirror — Build Status & Roadmap
> Last updated: April 15, 2026

---

## Current State

| Layer | Status |
|---|---|
| RSS ingest (every 30 min) | ✅ Live |
| Stage 1 content filter (R1–R5) | ✅ Live |
| Gemini summarisation (80–100 word prompt) | ✅ Live |
| Topic tagging | ✅ Live |
| 4-axis ideology classifier | ✅ Live — runs every 2h, 10 articles/batch |
| Source ideology profiles (`/sources`) | ✅ Live |
| Source profile pages (`/sources/[id]`) | ✅ Live |
| `/methodology` page | ✅ Live |
| Google OAuth (Supabase Auth) | ✅ Live — Build 3B shipped Apr 2026 |
| Preferences in DB (auto-migrate from localStorage) | ✅ Live — Build 3B shipped Apr 2026 |
| Embeddings (gemini-embedding-001, 768d) | ✅ Live — generated during summarise phase |
| Embedding backfill | ✅ Done — ~5k articles embedded Apr 2026 |
| Story clustering (pgvector cosine similarity) | ✅ Live — cluster job runs every 6h, 56 clusters created |
| Story detail pages (`/story/[id]`) | ✅ Live — framing comparison across sources |
| "N sources covered this" on feed cards | ✅ Live — Build 3C shipped Apr 2026 |
| Card feed (fan stack, drag-to-dismiss) | ✅ Live — UI Sprint Apr 2026 |
| List feed | ✅ Live |
| Topic filter bar | ✅ Live |
| Bottom nav (Feed / List / You) | ✅ Live — UI Sprint Apr 2026 |
| Onboarding (floating topic bubbles) | ✅ Live — UI Sprint Apr 2026 |
| Dark-only theme | ✅ Live — light theme removed Apr 2026 |
| Source cleanup | ✅ Done — Apr 2026 (see Data Sources section) |
| GDELT ingestion | ❌ Not yet — Build 3C next |
| Reading events | ❌ Not yet — Build 4A |
| Radar / reader profile | ❌ Not yet — Build 4B |
| Story timeline / topic following | ❌ Not yet — Build 5 (new) |

---

## Build Roadmap

### ✅ Build 1–2D — Foundation
RSS ingestion, summarisation, card/list feed, filters, preferences, admin, Stage 1 content filter.

### ✅ Build 3 — The Classifier
4-axis ideology classification, source profiles, lean pill on feed cards, `/methodology` page.

### ✅ Build 3B — Auth + Preferences Migration
Google OAuth via Supabase Auth. Preferences auto-migrate from localStorage to DB on first sign-in. Session persistence across devices.

### ✅ Build 3C (partial) — Embeddings + Clustering + Story Pages
Embeddings generated during summarise phase (gemini-embedding-001, 768d, `SEMANTIC_SIMILARITY` task type). Clustering runs as scheduled job every 6h via Postgres RPC (`cluster_similar_articles`, threshold 0.82, 10-day window). Story pages at `/story/[id]` with multi-source framing comparison. "N sources covered this" pill on feed cards. GDELT deferred to separate build.

### ✅ UI Sprint — Rebrand
Full visual rebrand: Plus Jakarta Sans headlines, Outfit body, pastel card palette (#FFE8E5 / #E0F1FF / #FFF2C5) on #111111 background. Fan-stack card layout with drag-to-dismiss. Three-item connected bottom nav (Feed / List / You). You sheet with auth state, interests, source profiles, methodology. Floating topic bubble onboarding. Light theme removed entirely.

---

### 🔲 Build 3C (remainder) — GDELT Ingestion ← NEXT

**Scope:**
- Add `?phase=ingest_gdelt` to Edge Function
- Query GDELT DOC API with `sourcecountry:IN` + language filters
- Filter to domains not already covered by active RSS sources
- Fetch article body from URL, run through Stage 1 → summarise → embed → classify pipeline
- Deduplicate against existing articles by URL

**Notes:** RSS stays primary. GDELT fills coverage gaps for vernacular and low-RSS sources.

---

### 🔲 Build 4A — Reading Events

**Scope:**
- Track article opens (source, topic, time spent) for logged-in users
- Write to `reading_events` table (already in schema)
- No UI — purely data collection

**Dependencies:** Build 3B ✅

---

### 🔲 Build 4B — Reader Profile + Radar Page

**Scope:**
- `/profile` page: 4-axis ideology breakdown, source diversity, topic distribution
- Weekly digest format, activates at 15+ articles read minimum
- No ideology nudges in feed — user infers from their own radar
- Blindspot surface (stories covered by only one framing) — brainstorm before building

**Dependencies:** Build 3B ✅ + Build 4A

---

### 🔲 Build 5 — Story Timelines + Topic Following

**Scope:**
- User can follow a named story/topic (e.g. "Iran-America war", "Noida wage protests")
- Timeline view: all articles on that topic in chronological order, across sources
- Stories are either auto-detected from clusters or user-created
- Separate surface from the main feed — dedicated tab or modal
- Push/badge notification when a followed story gets new coverage

**Key decisions before building:**
- Auto-detect timelines from clusters vs manual user-created topics?
- Where does it live in the nav — new 4th tab, or inside Explore?
- How long does a timeline stay live before being archived?

**Dependencies:** Build 3C clustering ✅ (timelines are built on top of story clusters)

---

### 🔲 Build 4C — Freemium

**Scope:** Deferred. Likely paid layer is radar + story timelines. Auth must exist first ✅.

---

## Feed Quality Strategy

### Problem: high-volume sources crowd out smaller/international ones
The top 80 articles are dominated by The Hindu, BusinessLine, NDTV — all high-frequency publishers. Guardian, Scroll, Hindustan Times rarely surface.

**Planned fixes (to implement before GDELT):**
1. **Raise feed limit** — increase from 80 to 150 articles in `app/feed/page.tsx`
2. **Source-capped query** — max N articles per source in the feed query so no single source takes more than ~15% of slots
3. **Relevance scoring** — surface articles with more cluster connections higher (more sources covering = more significant story)

### Clustering volume strategy
Currently 56 clusters from ~5k embedded articles. To increase:
1. The backfill is still running — 7k articles remain without embeddings; clusters will grow significantly once complete
2. Cluster job currently uses 10-day window; once backfill is done, drop back to 72h for ongoing operations
3. The new summarise phase now embeds every article on ingest — cluster count will grow organically from here
4. GDELT will add volume from more diverse sources, which is exactly what clustering needs

---

## Data Sources — Current Active

| Source | Articles | 7-day | Status |
|---|---|---|---|
| Times of India | 1,802 | 677 | ✅ Healthy |
| NDTV | 1,473 | 502 | ✅ Healthy |
| The Hindu BusinessLine | 1,468 | 521 | ✅ Healthy |
| Mint | 1,407 | 496 | ✅ Healthy |
| The Hindu | 1,304 | 486 | ✅ Healthy |
| ET Now | 692 | 277 | ✅ Healthy |
| Guardian | 397 | 234 | ✅ Healthy — international coverage |
| Scroll | 352 | 140 | ✅ Healthy |
| Hindustan Times | 248 | 112 | ✅ Low volume — monitor |
| Inc42 | 184 | 52 | ✅ Startup/tech niche |
| Opindia | 105 | 29 | ✅ Right-lean perspective — intentional |
| India Today | 96 | 31 | ⚠️ Very low ingest — RSS intermittent |
| Economic Times | 0 | — | 🆕 Added Apr 2026 |
| Economic Times Politics | 0 | — | 🆕 Added Apr 2026 |
| BBC India | 0 | — | 🆕 Added Apr 2026 |
| Firstpost India | 0 | — | 🆕 Added Apr 2026 |

**Deactivated (deduplication):** The Hindu National feed, NDTV Latest
**Deleted (broken RSS, 0 articles):** The Wire, The Print, Indian Express (×2), First Post World, Moneycontrol, Analytics India Magazine, Gadgets 360, Business Standard

### Planned: GDELT (Build 3C remainder)
Supplementary ingestion for vernacular sources and outlets without working RSS. `sourcecountry:IN` filter, covers Hindi/Tamil/Telugu/Marathi/Malayalam and more.

---

## Dependency Chain

```
Auth (3B) ✅
  └── Reading events (4A)
        └── Reader profile / radar (4B)

Embeddings + clustering (3C) ✅ partial
  └── Story pages (3C) ✅
  └── GDELT ingestion (3C remainder)
  └── Story timelines / topic following (Build 5)
  └── Feed quality improvements (source cap, relevance score)
        └── Reader profile nudges (4B)
```

---

## Known Bugs & Tech Debt

| Issue | Severity | Status | Notes |
|---|---|---|---|
| Ingest occasionally times out (curl exit 28) | Medium | Mitigated | `--max-time 145` in `ingest.yml`. |
| Next.js 14.2.5 security advisory | Low | Pending | Upgrade when convenient. |
| Admin page has no auth | Low | Acceptable | Add Vercel password protection before wider launch. |
| Cluster window still at 10 days | Low | Pending | Drop back to 72h once embedding backfill completes. |
| India Today RSS low ingest rate | Low | Monitor | 1–11 articles/day vs 40–67 for healthy sources. |
| New sources (ET, BBC, Firstpost) unverified | Low | Pending | Will confirm working after next ingest cycle. |
