# Build Audit — April 1, 2026

## Scope reviewed
- Frontend routes/components under `app/` and `components/`
- Supabase schema + seed
- Ingest edge function
- Recent commit log (`git log --oneline`)

## Logged issues status (from recent commit history)

Recent issue-style commits show these items as **completed** in code:

1. **Sources page CSS module scoping errors fixed**
   - Recent commits indicate `:local()` removal in sources CSS and the page styles compile path was fixed.
2. **Feed UI polish from mock implemented**
   - Refresh loading states and feed visual polish appear in the feed client.
3. **Supabase SSR cookie typing/migration fixes**
   - `createServerClient` usage in pages has been updated to async call sites.
4. **`sample_size` → `article_sample_count` migration fixes**
   - Source ideology/profile pages read `article_sample_count`.
5. **Topic filter prop mismatch fix**
   - `FeedClient` and `TopicFilter` prop contract is aligned.

## Build roadmap progress check

### Build 1 — Reader (**mostly complete**) 
Implemented:
- Feed route + article query + summary-first display
- Topic tags + search + list/cards view + onboarding preferences
- Ingest API trigger route and edge function summarization/topic tagging

Gaps/risk:
- README says cron should run every 30 minutes, while edge function header comment says every 5 hours (`0 */5 * * *`). This is operationally inconsistent and can cause stale expectations.

### Build 2 — Filter (**partially complete**) 
Implemented:
- Local (browser) topic/source preferences UX exists.
- DB has clustering tables + embeddings and user preference table.

Not implemented or not wired:
- No auth flow/UI connected to Supabase auth.
- No server-backed read/write of `user_preferences` in the app; preferences are localStorage-based.
- No clustering job or cluster-aware feed rendering despite schema support.

### Build 3 — Classifier (**substantially complete in data layer + mostly complete in UI**) 
Implemented:
- Ingest function includes 4-axis classifier prompt + rationale.
- Schema has per-article scores and aggregate `source_ideology_scores`.
- `/sources` and `/sources/[id]` render source profiles with readiness thresholds and rationale cards.

Gaps/risk:
- `/sources` queries `sources.active`, but `sources` schema does not define an `active` column. This is a high-confidence runtime/query break unless the production DB has a manual drift not represented in `schema.sql`.
- `/sources` and source profile pages link to `/methodology`, but route is missing.

### Build 4 — Mirror (**not started in product surface**) 
Implemented in schema only:
- `reading_events` table + policy/index.

Not implemented:
- No reading event instrumentation from UI.
- No perspective radar or weekly digest workflows.

## Suggested next build plan (priority order)

### Phase 0 — Stabilization (1 short sprint)
1. Align DB schema + app queries:
   - Add `sources.active boolean not null default true` migration, or remove `.eq('active', true)` filter.
2. Add missing `/methodology` page.
3. Reconcile cron frequency docs/comments and choose one SLA (30 min vs 5h).
4. Add a lightweight smoke checklist for feed, sources index, and source profile routes.

### Phase 0 smoke checklist (manual run)
After deploying to main, run these quick checks:

1. **Feed (`/feed`)**
   - Page renders without errors.
   - At least one story card or list item appears.
   - Card/list toggle, topic pills, and source filter respond to clicks.

2. **Sources index (`/sources`)**
   - Page loads without 500 errors.
   - Active sources list appears with readiness state.
   - Clicking a source opens its `/sources/[id]` profile.

3. **Source profile (`/sources/[id]`)**
   - Profile header renders with name and home URL.
   - Ideology axes or rationale chips render (or "Building" state for low sample size).
   - "Methodology" link navigates to `/methodology` and the page loads.

4. **Ingest/classify health**
   - Latest **NewsMirror ingest** workflow run in GitHub Actions succeeded.
   - Supabase `articles` table shows new rows in the last 6 hours.
   - If classification is enabled, `source_ideology_scores` has recent `scored_at` entries.

### Phase 1 — Complete Build 2 fundamentals
1. Ship Supabase Auth (email OTP or OAuth) with optional anonymous mode.
2. Migrate preferences from localStorage to `user_preferences` for signed-in users (fallback localStorage for guests).
3. Introduce clustering pipeline:
   - Generate embeddings
   - Assign/update `story_clusters`
   - Render clustered feed option

### Phase 2 — Harden Build 3
1. Add classifier quality guardrails:
   - Sample-based evaluation job
   - Drift checks by source/topic
   - Admin diagnostics for low-confidence outputs
2. Add source-profile caching/revalidation and failure-safe empty states.

### Phase 3 — Start Build 4
1. Track reading events from card opens / dwell time.
2. Build a first perspective radar from `reading_events` + source ideology.
3. Launch weekly digest as a simple scheduled summary (email/push later).
