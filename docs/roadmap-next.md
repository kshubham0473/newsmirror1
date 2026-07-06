# Roadmap — agreed 6 July 2026

Ordering decided: informal PWA sharing starts now; production hygiene moves to
the END (before any public/open launch).

## Phase A — Moat: measurement + richer signals (next build)
1. Eval harness: log which feed ordering was shown and what got engaged
   (dwell/flip/open per slot) so algorithm changes are measured, not vibes.
2. Negative signals: fast flick-past (<2s on an active card) = disinterest
   (small negative affinity weight).
3. Entity-level affinity: extract people/parties/places during summarise
   (same Groq call, no extra cost); affinity on entities beats topics.

## Phase B — Social: acquisition artifacts
1. Shareable "framing gap" cards — same story, two headlines, auto-generated
   image for Twitter/Insta/WhatsApp.
2. Weekly blot share card (Wrapped-style).
3. Reddit r/india as trending *signal* (cluster boost), not as a source.

## Phase C — Production hygiene (before opening to the public)
1. Server-side auth guard on /admin (middleware, not client-only).
2. Enable RLS on rss_probe_results; delete gemini-probe function.
3. PWA "new version — tap to refresh" toast.
4. Privacy note (reading + dwell tracking disclosure) linked from You sheet.
5. PostHog analytics: retention, flips, nudge acceptance, mirror visits.
6. Error-state pass: empty feed, failed images, offline.

## Standing data-quality list
- NULL published_at on some Mint articles (sorting)
- Legacy all-zero classifier scores (treated as null in code; clean up rows)
- 22k pre-pause articles unprocessed (deliberately skipped)
- Swarajya/Firstpost need scraper-based ingestion (bot-walled)
