# Reading Experience v2 — Design

**Date:** 2026-07-18 · **Status:** Approved direction, pre-implementation
**Problem:** After a week of dogfooding, the app lost daily-news duty to Twitter. Diagnosis from data: the pipeline is fresh (last ingest 1.3h old; 42 Wangchuk, 23 World Cup, 21 EPL articles in 48h) but **surfacing fails** — ranking buries fresh/followed stories, personalization is too coarse (12 topics), and the Mirror's 4-axis ideology verdict is neither understood nor believed.

## Decisions made

1. **Mirror measures behavior, not ideology** — described in politically familiar vocabulary (diet of framing consumed), never a verdict about the reader.
2. **Ranking philosophy = catch-up delta** — "since you left," not real-time firehose. We beat Twitter at organized catch-up, we don't chase it at velocity/opinions/video.
3. **Personalization = implicit entity affinity + explicit follows.**
4. **Free tier stands.** All new LLM work must scale with news volume (~flat), never with user count. Build 3 items are deferred indefinitely.

---

## 1. Mirror v2 — "Your reading diet"

Headline surface changes from a 4-axis reader profile to a consumption report:

- **Diet mix:** share of reads whose coverage carried pro-government / critical / wire-neutral framing, plus outlet-diversity count. E.g. "24 stories, 6 outlets. 70% pro-government framing, 20% critical, 10% neutral."
- **Blindspot card:** stories the reader saw only one side of (cluster had divergent framing; reader opened only one frame, never flipped).
- **Framing-gap engagement:** "You opened 3 of 11 framing gaps we showed you."
- The 4 axes (identity, state-trust, economic, institution) remain in the pipeline unchanged; they surface only as per-article plain-word "why" details.
- **No user-level ideology label exists anywhere.**

Data: existing `reading_events`, article axis scores, cluster framing analysis, source profiles. Presentation-layer rebuild; no pipeline changes.

Risk accepted: outlet/article framing labels ("pro-government") will be contested. Defense: every label links to per-article evidence the reader actually read.

## 2. Catch-up delta — "Since you left"

- Track `last_visit` (localStorage; `reading_events` for signed-in).
- On open, feed head = **delta block**: clusters/threads that gained articles since last visit, ranked by `follow-affinity × outlet-velocity × freshness` (velocity = distinct outlets on the cluster in a recent window — computed from existing cluster data).
- Lead card: "While you were away — N developments," each with its one-line beat (see LLM phases). Visible seam after the delta, then the regular feed.
- **Freshness hard-bucketing** in the regular feed: articles >12h old cannot outrank <6h articles unless boosted by an explicit follow.

## 3. Entity-level personalization

- **Implicit:** `lib/affinity.ts` extends from `topic_tags` to `key_entities` (already extracted on every article — zero pipeline cost). Same signals (open/flip/dwell/react), same 7-day half-life. Entity keys normalized via `entity_directory`.
- **Explicit:** one-tap **"Follow this story"** on flip-card backs, thread pages, timeline pages. Stored in prefs (server for signed-in, localStorage guests). Explicit follows are strong-weighted and seed the catch-up delta from day one.

## 4. New LLM phases (Build 2, free-tier budget)

| Phase | What | Cost | Notes |
|---|---|---|---|
| `beat-clusters` | One 70B call per cluster update: a single "what changed" line | ~50–150/day, cached per cluster | Powers delta cards + timelines. Cost scales with news, not users |
| Delta narration | 2–3 sentence "while you were away" overview assembled from cached beats | ~0–20/day | Mostly code-side assembly |
| `entity-cards` | "Who is X / why it matters" per NEW entity, cached forever | ~10–30/day tapering | Solves joining-a-saga-late |

Deferred (Build 3, only if free tier ever upgraded): columnist-reaction synthesis, classification spot-audit. Explicitly rejected: per-user briefs, news chat (cost scales with users). Real tweets rejected: X API ≥ $200/mo.

Budget guardrail: Groq 70B free cap is 1k req/day; new phases add ~250/day worst case. If collisions with existing phases appear on heavy news days, phases degrade gracefully (skip beats, show plain headlines) rather than error.

## 5. Ambient political color

- Palette re-tint: `--spec-warm` → **saffron-orange** (right / pro-establishment framing, legible in India), `--spec-cool` → cool teal-blue (left / critical framing), neutral stays muted.
- Applied ambiently — card edge/tint, digest dots, timeline entries, Mirror diet bars — wherever framing is distinguishable.
- **Confidence gate:** tint only when multi-axis scores exist and sit away from center; default is neutral. A wrong saffron/red label costs more trust than the feature earns.
- Colors always describe **the framing of the coverage, never the topic or the subject**. A one-line legend states this in-app.

## 6. Quick wins (Build 1)

- Timeline pages: latest-first (descending).
- Multi-outlet flip cards: subtle wobble/shake when the card snaps active (peel's successor).
- Freshness hard-bucketing (from §2) ships here — it's independent of follows.
- Ambient color re-tint (§5) ships here; wider application lands with each surface it touches.

## Build order

1. **Build 1 — felt immediately:** timeline order, wobble, freshness buckets, saffron/teal re-tint.
2. **Build 2 — retention core:** entity affinity + follow button + catch-up delta + `beat-clusters` + entity cards.
3. **Build 3 — later:** Mirror v2 — largest surface, least daily-retention impact, but fully free-tier feasible (presentation-layer only), so it happens, just last. The columnist layer and classification audit are the only items conditional on ever leaving the free tier.

*(Note: Mirror v2 moved to Build 3 scope — it disappoints but doesn't churn daily usage; catch-up does.)*

## Success criteria

- Morning open shows ≥1 followed-story development published <6h ago, above the fold.
- No article >16h old in the first 5 cards unless followed.
- User can name what the strip/colors mean without documentation.
- API usage stays within free tiers on a heavy news day.
