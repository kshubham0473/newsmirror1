# NewsMirror — Build Status & Roadmap
> Last updated: April 13, 2026

---

## Current State

| Layer | Status |
|---|---|
| RSS ingest (every 30 min) | ✅ Live |
| Stage 1 content filter (R1–R5) | ✅ Live |
| Gemini summarisation (80–100 word prompt) | ✅ Live — new prompt deployed Apr 2026 |
| Topic tagging | ✅ Live |
| 4-axis ideology classifier | ✅ Live — runs every 2h, 10 articles/batch |
| Source ideology profiles (`/sources`) | ✅ Live — ~10 sources have profiles |
| Source profile pages (`/sources/[id]`) | ✅ Live |
| `/methodology` page | ✅ Live |
| Card feed (snap-scroll) | ✅ Live — image/text split layout (Apr 2026) |
| List feed | ✅ Live |
| Topic + source filters | ✅ Live |
| Light/dark theme | ✅ Live |
| Preferences (localStorage) | ✅ Live — to be migrated to DB in Build 3B |
| Auth | ❌ Not yet |
| Embeddings / clustering | ❌ Not yet |
| Reading events | ❌ Not yet |
| Personalised nudges | ❌ Not yet |

---

## Build Roadmap

### ✅ Build 1–2D — Foundation
RSS ingestion, summarisation, card/list feed, filters, preferences, admin, Stage 1 content filter.

### ✅ Build 3 — The Classifier
4-axis ideology classification, source profiles, lean pill on feed cards, `/methodology` page.

### ✅ Build 5A — Reading Experience (partial)
New 80–100 word summary prompt live. Topic diversity round-robin sort in feed. Card layout redesigned (image top 48%, solid text zone bottom 52%).

---

### 🔲 Build 3B — Auth + Preferences Migration ← NEXT

**Scope:**
- Google OAuth via Supabase Auth
- On sign-in: migrate localStorage preferences (topics, sources) to `user_preferences` DB table automatically
- Session persistence across devices
- Analytics: know who is using the app

**Out of scope for 3B:** clustering, radar page, reading events.

**Key decisions:**
- Google OAuth only (not magic link) — lower friction, enables analytics
- Preferences auto-migrated on first sign-in, not manually
- Radar page deferred — functionality to be defined first, UI second

**Dependencies:** None. Can start immediately.

**Risk:** Supabase Auth + Next.js App Router requires `@supabase/ssr` which is already in `package.json`. Session handling in server components needs care — use `createServerClient` (already in `lib/supabase-server.ts`) consistently.

---

### 🔲 Build 3C — Clustering + Story Pages + GDELT

**Scope:**
- Generate embeddings per article during `?phase=summarise` — write to existing `embedding vector(768)` column
- Create pgvector IVFFlat index once article count exceeds 1,000
- Cluster articles by embedding similarity → populate `story_clusters` + `article_clusters` tables (already in schema)
- Story detail page inside the app: all sources covering the same event, framing comparison side by side
- Surface "N sources covered this" on feed cards
- GDELT as supplementary ingestion for sources without working RSS (see Data Sources section)

**Out of scope for 3C:** personalised nudges (needs reading history).

**Dependencies:** Build 3B not required. Can run independently.

**Risk:** Embedding generation adds one Gemini call per article during summarisation. Fine at current volume. pgvector IVFFlat index must be created manually after 1,000+ articles: `CREATE INDEX USING ivfflat (embedding vector_cosine_ops)`.

---

### 🔲 Build 4A — Reading Events

**Scope:**
- Track article opens (source, topic, time spent) for logged-in users
- Write to `reading_events` table (already in schema)
- No UI — purely data collection

**Dependencies:** Build 3B (need a user_id to attach events to).

---

### 🔲 Build 4B — Reader Profile + Radar Page

**Scope:**
- `/profile` page showing user's reading patterns across all 4 ideology axes
- Weekly digest format — not real-time
- Visual graphs: axis breakdown, source diversity, topic distribution (similar to Ground.news reader profile)
- Nudge activates once user has read 15+ articles minimum
- No ideology nudges pushed into the feed — user infers from their own radar
- "Blindspot" discovery surface (stories covered by only one framing) — separate surface, brainstorm before building

**Dependencies:** Build 3B + Build 3C + Build 4A (reading events with sufficient data).

**Open questions before building:**
- Which axes to show on the radar — all 4 or simplified?
- Weekly digest: email notification vs in-app badge?
- How many weeks of history to show by default?

---

### 🔲 Build 4C — Freemium

**Scope:** Deferred. Monetisation strategy pending. Likely paid layer is the reader profile/radar. Auth and reading history must exist first.

---

## Data Sources — Current & Planned

### Current: RSS feeds
Working for ~15 sources. Problems: several sources have broken/absent RSS (The Wire, some regional outlets), wire service reposts inflate volume with low editorial value.

### Planned: GDELT (Build 3C)

GDELT is a free, completely open global news monitor updated every 15 minutes. Relevant facts for NewsMirror:

**What we get from GDELT:**
- `sourcecountry:IN` filter returns Indian-origin articles
- Covers Hindi, Tamil, Telugu, Marathi, Malayalam, Punjabi, Gujarati, Urdu — sources that don't publish RSS
- Up to 250 article URLs per request: title, URL, date, source domain, language
- Updates every 15 min — same cadence as our current ingest

**What we don't get:**
- Full article body — GDELT returns URLs only, content must be fetched separately
- Perfect metadata — academic research puts field accuracy at ~55%, but our Stage 1 filter + Gemini summarisation acts as a quality gate

**Integration plan (Build 3C):**
Add `?phase=ingest_gdelt` to Edge Function:
1. Query GDELT DOC API with `sourcecountry:IN` + language filters
2. Filter to domains not already covered by active RSS sources
3. Fetch article content from URL
4. Run through existing Stage 1 filter → summarise → classify pipeline
5. Deduplicate against existing articles

RSS stays primary. GDELT is supplementary for coverage gaps only.

---

## Dependency Chain

```
Auth (3B)
  └── Reading events (4A)
        └── Reader profile / radar (4B)
              └── Blindspot surface (TBD — brainstorm before build)

Embeddings + clustering (3C) — independent of auth
  └── Story pages with multi-source framing (3C)
  └── "N sources covered this" on feed cards (3C)
  └── GDELT supplementary ingestion (3C)
  └── Can feed into reader profile nudges (4B) later
```

---

## Known Bugs & Tech Debt

| Issue | Severity | Status | Notes |
|---|---|---|---|
| Ingest occasionally times out (curl exit 28) | Medium | Mitigated | `--max-time 145` in `ingest.yml`. Reduce `SOURCES_PER_RUN` from 4 to 3 if it persists. |
| pgvector IVFFlat index not created | Low | Pending | Add after 1,000+ articles: `CREATE INDEX USING ivfflat`. No impact until Build 3C. |
| Next.js 14.2.5 security advisory | Low | Pending | Upgrade to latest when convenient. |
| Admin page has no auth | Low | Acceptable | Add Vercel password protection before wider launch. |
| `sample_size` column mismatch | Fixed | ✅ | Schema uses `article_sample_count`. Frontend fix shipped Apr 2026. |
| Card layout — text invisible on light images | Fixed | ✅ | Solid text zone (48/52 split) shipped Apr 2026. |
| Several RSS sources broken or low quality | Ongoing | Monitor | Stage 1 filter handles quality. GDELT fills coverage gaps in Build 3C. |
