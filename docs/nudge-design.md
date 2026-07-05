# The Nudge — Design Spec (agreed 5 July 2026)

The core editorial-intelligence feature: detect when a reader's diet tilts to one
side of the framing spectrum and surface the same story through a contrasting lens.

## Decisions locked

**Baseline: pool-relative.** The reader's footprint is compared against the average
framing of the sources NewsMirror carries — NOT against the classifier's absolute 0.5.
Rationale: the source pool currently skews left of 0.5 on all axes; an absolute
baseline would tell every reader they lean left forever, which is a lecture, not a
mirror. Pool-relative stays honest as the catalogue rebalances.

**Tone: never accusatory.** Copy pattern: "Balancing your read — here's [outlet]'s
take on this story", "same story, different lens". Never "you are biased".

## Footprint computation

1. Pull the reader's last 7 days of `reading_events`, joined to article scores.
2. Per axis: `footprint[axis] = avg(article score)` using article-level scores where
   present (> 0 — exactly-0.0 scores are a known classifier artefact, skip), falling
   back to the source's `source_ideology_scores` value for unscored articles.
3. Pool baseline per axis: read-count-weighted average of `source_ideology_scores`
   across active sources (precomputed, cached).
4. Tilt per axis = footprint − pool baseline. Nudge axis = argmax |tilt|.

## Trigger rules

- Minimum 10 scored reads in the window; otherwise no nudges at all.
- |tilt| ≥ 0.08 on the top axis (tune after observing real data).
- At most 1 nudge per ~9 cards in the snap feed; at most 2 per session;
  never two consecutive nudges on the same axis.
- Guests (signed out): no nudges (no reading events).

## Article selection (in priority order)

1. Same cluster as something the reader read this week, from a source on the
   opposite side of the nudge axis (pool-relative), with a summary.
2. Same topic tag, opposite-side source, published in the last 48h.
3. If nothing qualifies: no nudge. Never force it.

## UI

- Dark ink card variant in the snap feed (design exists in mockup v3: breathing
  terracotta glow, "◑ Balancing your read" tag, italic why-line naming the axis in
  plain words, headline, source, animated "your pull on this axis" spectrum).
- The why-line must name concrete behaviour: "You've read this story from three
  welfare-framing outlets" — not abstract ideology labels.
- Reactions on nudge cards are tracked with a `nudge` flag → future measure of
  whether nudges are read or dismissed (freemium signal later).

## Implementation plan (next session)

1. `lib/useFootprint.ts` — client hook: fetch events + scores, compute tilt.
   (Server API route if query cost demands it.)
2. Pool baseline: SQL view `source_pool_baseline` (read-weighted axis averages).
3. `NudgeCard.tsx` + slot injection in `SnapFeed.buildSlots()` (every ~9th slot when
   a nudge is armed).
4. Selection query for the contrast article.
5. Mirror page: show tilt-vs-pool on the axis bars (pool marker replaces the 0.5 marker).

## Source balance status (prerequisite)

Added 5 Jul: **Republic World** (rss/india.xml), **The Print** (category/india/feed).
Blocked by bot walls (403): Zee News, ANI, Firstpost. Swarajya has no populated feed.
Revisit blocked outlets later — would need HTML scraping, not RSS.
Profiles for the new sources accumulate via nightly `profile-sources`; expect usable
scores within ~2–3 days of ingestion.
