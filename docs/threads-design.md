# Threads (Living Issues) — Design Spec

> Agreed 6 July 2026. The next core-moat feature. Iterative, multi-session.

## The problem it solves
The feed treats all news as flat and momentary. A one-off crime sits at the same
weight and lifespan as a weeks-long national debate (E20 ethanol, Ram Mandir theft).
Clusters only understand *events* (same story, ~72h window). Readers open the app to
form an educated, all-round opinion on the handful of pressing ongoing *issues* — and
those are exactly what the current build buries.

## The primitive: a Thread
A durable, persistent issue that accumulates clusters/articles over days–weeks and
carries an evolving, perspective-aware understanding. Extends the mirror thesis from
"sides of a story today" → "sides of a story over time."

Decisions locked:
- **Shape:** time-spine + synthesis. A scrollable day-by-day timeline of how the issue
  evolved, topped by a living "where it stands / all sides" synthesis.
- **Grounding:** own sources ONLY (the 27 ingested feeds). Cited, no hallucination,
  reinforces "we read across the spectrum for you." Web search deferred to a later,
  clearly-labelled phase for background gaps only.
- **Surfacing:** a dedicated "Threads" destination (via masthead), plus a rare,
  visually-distinct Thread card injected in the feed pointing into it. Feed reading
  space is preserved.

## The non-negotiable guardrail
Synthesis is **descriptive, never prescriptive.** It says "the government frames this as
energy independence; critics frame it as a sugar-lobby subsidy that raises food prices" —
never "here's the correct view." The moment we editorialize, we become just another
outlet with a take and lose the neutral-referee position that is the whole USP.

## Data model (proposed)
```
threads
  id, title, slug, status (developing|dormant|closed),
  key_entities text[], topic_tags text[],
  synthesis JSONB,          -- { where_it_stands, sides:[{label, outlets[], emphasis}], updated_at }
  spectrum_spread JSONB,    -- distribution of framings across the axis
  first_seen, last_beat_at, updated_at

thread_beats               -- the time-spine
  id, thread_id, beat_date, headline, what_happened,
  cluster_id (nullable link), source_perspectives JSONB, created_at

thread_articles            -- linking table
  thread_id, article_id, added_at
```

## Detection (cheap, no LLM)
- Entity extraction piggybacks the existing summarise Groq call (near-zero extra cost) →
  every article gets `key_entities`.
- Daily job groups recent clusters by shared entity constellation; matches to an existing
  Thread or proposes a new one.
- Promotion heuristic: an entity-set that produced clusters on ≥3 distinct days in a
  rolling window becomes a Thread. (Threshold tunable, like the cluster threshold.)
- Optional light editorial gate at first (you approve proposed Threads) to keep quality
  high while the heuristic matures.

## Synthesis (LLM, own sources, ~5–6 threads/day = trivial quota)
Once/day per active Thread: feed the LLM the Thread's articles grouped by
source/perspective + the previous synthesis; ask for (a) updated "where it stands",
(b) "what each side emphasizes" with outlet citations, (c) a new beat for what changed.
Groq 70B, descriptive-only prompt.

## UI
- **Threads destination** — new masthead icon (next to blot/filter). Lists 5–6 live
  issues: title, "5 days · 12 articles", mini spectrum spread.
- **Thread page** — top: living synthesis (where it stands + the sides, cited); below:
  the time-spine (reverse-chron beats, each with date, what happened, perspective chips).
- **In-feed Thread card** — rare, standout (like the nudge slot): "Developing · E20
  ethanol — day 5, 3 perspectives → open thread." Does not pressure reading space.

## Phasing (each phase independently valuable)
1. **Entity extraction** — add to summarise call; backfill recent articles. Doubles as
   the entity-affinity upgrade already on the roadmap (Phase A moat). Low-risk first slice.
2. **Data model + detection job** — threads / thread_beats / thread_articles; recurrence
   heuristic; optional editorial gate.
3. **Synthesis job** — daily descriptive brief + beats per active Thread.
4. **UI** — Threads destination, Thread page, in-feed card.
5. **Refinement** — dormancy/closing lifecycle, dedup, detection tuning; later: labelled
   web-search augmentation.

## Recommended first build slice
Phase 1 (entity extraction) — cheapest, lowest-risk, and it advances TWO moats at once
(Threads foundation + entity-level affinity for the interest algorithm).

## Detection v2 — failure modes found in first real run (7 Jul) and fixes

First run produced 24 threads; real issues (E20, Iran ceasefire, Mamata/EC) were present
but drowned. Measured failure modes and the shipped fixes:

1. **Generic anchors** — "Nitin Gadkari" (21.2% of corpus!), "India" (13.1%), "BJP",
   "Mumbai" anchored junk mega-threads; Gadkari swallowed 222 articles incl. all of E20.
   Fix: DF ceiling (anchor must appear in <12% of window corpus, env `THREAD_MAX_DF`)
   + hard stoplist of structurally generic entities (countries/states/metros/parties/
   institutions). Both only block ANCHORING — generics remain as related entities.
2. **Alias fragmentation** — Ram Mandir theft (a month-long issue) never became a
   thread because its ~30 articles were split across 8+ variants ("Ram Temple",
   "Ram mandir", "Ayodhya Ram Temple", "Ram Temple Trust", "Shri Ram Janmabhoomi…").
   Fix: normalization layer in detection (case-fold, strip parentheticals/possessives,
   mandir→temple synonym) + token-subset alias merge ("ram temple" absorbs
   "ayodhya ram temple"). Lives in detection, not extraction → tunable forever
   without re-spending API calls.
3. **No source-diversity gate** — one outlet's drumbeat could form a "thread".
   Fix: ≥3 sources required (`THREAD_MIN_SOURCES`).
4. **No lifecycle** — threads never went quiet or revived.
   Fix: developing (≤3d since last article) / steady (≤7d) / dormant; threads not
   refreshed by a run are auto-dormant; upsert keys on normalized `anchor_key`
   so revivals reattach instead of duplicating.
5. **The durable fix: entity types** (accruing since v41+): extraction now returns
   {name, type}; types stored in `articles.entity_types`. Once typed data dominates,
   detection enforces: anchors must be policy/event/scheme/case/bill/project/
   controversy — a person/place/org/party can never anchor an issue. This is the
   principled answer to the Gadkari problem; thresholds are the interim answer.

## Deferred detection upgrades (documented, deliberately not built — complexity budget)
- Embedding-coherence score per thread (vectors already exist): catch wrong-merges,
  flag low-coherence threads for review/split.
- Cluster-chain signal: articles sharing a story_cluster must share a thread; issues
  as chains of event-clusters.
- Burstiness vs baseline DF (needs longer entity history than we have yet).
- LLM adjudication of borderline anchor merges (only if heuristics plateau).

## Open questions for later
- Cold start: threads need a few days of entity data; may seed 2–3 manually for demo.
- When does a dormant Thread close permanently?
