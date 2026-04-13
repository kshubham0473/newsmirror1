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

**Key decisions already made:**
- Google OAuth only (not magic link) — lower friction, enables analytics
- Preferences auto-migrated on first sign-in, not manually
- Radar page deferred — functionality to be defined first, UI second

**Dependencies:** None. Can start immediately.

**Risk:** Supabase Auth + Next.js App Router requires `@supabase/ssr` which is already in `package.json`. Session handling in server components needs care — use `createServerClient` (already in `lib/supabase-server.ts`) consistently.

---

### 🔲 Build 3C — Clustering + Similar Articles

**Scope:**
- Generate embeddings for each article during `?phase=summarise` — write to existing `embedding vector(768)` column
- Create pgvector IVFFlat index once article count exceeds 1,000
- Cluster articles by embedding similarity → populate `story_clusters` + `article_clusters` tables (already in schema)
- Surface "N sources covered this" on feed cards / article view

**Out of scope for 3C:** personalised nudges (needs reading history).

**Dependencies:** Build 3B (auth) not required. Can run in parallel or after.

**Risk:** Embedding generation adds a Gemini call per article during summarisation. At current volume (~15 articles/batch) this is fine. Monitor costs if volume increases significantly. pgvector IVFFlat index must be created manually after 1,000+ articles: `CREATE INDEX USING ivfflat (embedding vector_cosine_ops)`.

---

### 🔲 Build 4A — Reading Events

**Scope:**
- Track article opens (source, topic, time spent) for logged-in users
- Write to `reading_events` table (already in schema)
- No UI yet — purely data collection

**Dependencies:** Build 3B (need a user_id to attach events to).

---

### 🔲 Build 4B — Perspective Radar + Personalised Nudges

**Scope:**
- `/radar` page: personal weekly summary of reading patterns across the 4 ideology axes
- "You've read mostly from sources that tend toward X" — framed as observation, not judgement
- Feed nudges: "Based on your reading, you haven't seen coverage from [source]" — surfaced as a subtle card in the feed

**Dependencies:** Build 3B (auth) + Build 3C (clustering) + Build 4A (reading events with enough data).

**Note:** The nudge requires at minimum a few sessions of reading data before it's meaningful. Don't surface it until a user has read 20+ articles.

---

### 🔲 Build 4C — Freemium

**Scope:** To be defined. Perspective radar / personalised nudges are the likely paid layer. Auth and reading history must exist first.

---

## Known Bugs & Tech Debt

| Issue | Severity | Notes |
|---|---|---|
| Ingest occasionally times out (curl exit 28) | Medium | `--max-time 145` set in `ingest.yml`. Happens when Supabase Edge Function approaches 150s limit. Monitor — may need to reduce `SOURCES_PER_RUN` from 4 to 3 if it persists. |
| pgvector IVFFlat index not created | Low | Add after 1,000+ articles: `CREATE INDEX USING ivfflat`. No impact until Build 3C. |
| Next.js 14.2.5 security advisory | Low | Upgrade to latest Next.js when convenient. No known exploits in production context. |
| Admin page has no auth | Low | Fine for personal beta. Add Vercel password protection before wider launch. |
| `summarise.yml` was calling bare Edge Function URL (no `?phase=`) | Fixed | Now correctly calls `?phase=summarise`. Old articles in DB have 2–3 sentence summaries. New articles get 80–100 word summaries. No backfill planned. |
| `sample_size` column mismatch | Fixed | Schema uses `article_sample_count`, frontend was querying `sample_size`. Fixed in Apr 2026 — sources page now shows profiles correctly. |
| Card layout broken after previous patch attempt | Fixed | Reverted to original JSX. CSS-only split layout (48/52) shipped Apr 2026. |

---

## Dependency Chain (simplified)

```
Auth (3B)
  └── Reading events (4A)
        └── Personalised nudges (4B)

Embeddings (3C) — independent
  └── "N sources covered this" clustering (3C)
  └── Can feed into personalised nudges (4B) later
```

---

## Questions to Resolve Before Build 4B

- What does the radar page actually show? (weekly digest vs real-time? which axes?)
- At what reading volume does a nudge become meaningful? (suggested: 20+ articles)
- How do we frame ideology nudges to feel helpful not preachy?
- Freemium line: what's free, what's paid?
