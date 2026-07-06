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

## Open questions for later
- Thread detection precision (merge/split tuning) — will need calibration like clustering.
- Cold start: threads need a few days of entity data; may seed 2–3 manually for demo.
- Dormancy: when does a Thread go quiet vs closed?
