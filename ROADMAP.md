# NewsMirror — Product Roadmap
**Approach C: The Trojan Horse Sequence**
_Last updated: April 2026_

---

## Product Vision

NewsMirror has two jobs, sequenced deliberately:

1. **Be the only news app they need.** A reading experience so good it replaces Times of India, NDTV, Inshorts — whatever they currently use. This is the Trojan Horse.

2. **Be a mirror of how they read.** Once they're regulars, the app quietly surfaces their reading patterns and cognitive biases through subtle ambient signals and an optional deeper profile. Not preachy. Not confrontational. Just honest.

**Target user:** A casual Indian news reader with a faint awareness of media bias, who doesn't actively seek balance. The algorithm-driven world is pushing their bias stronger every day. If the app can show them their own habits, there's a chance they seek to break out.

**Core design principle:** Depth should feel as effortless as a swipe. Make the mirror so subtle they discover it — never feel lectured by it.

---

## Completed Builds

| Build | What shipped |
|---|---|
| Build 1–3 | RSS ingestion, Gemini summarisation + tagging, embedding + clustering pipeline |
| Build 4A | Card swipe feed, topic pills, source filter, lean indicators, bottom nav, auth |
| Build 4B | Deferred — `reading_events` table exists but no data yet |
| Build 5 | Story timelines (`/timeline/[id]`), framing comparison, Follow story (DB-backed, auth-gated) |

---

## Approach C: Two Parallel Tracks

**Track 1 — Reading Experience:** Fill the gaps that make a user bounce back to their old app.
**Track 2 — Cognitive Mirror:** Build the ambient signal layer and reading profile that make this app irreplaceable.

These tracks feed each other: a better reading experience → more reading events → richer mirror → stronger retention.

---

## Build 6 — Onboarding + PWA
**Track 1**

The first thing a new user sees is a card feed with no context. They don't know what the lean pills mean. They don't know why there's a "3 sources covered this" pill. They have no reason to sign in. This build fixes that.

**Scope:**
- First-run swipeable intro (3 cards max): what the feed is, what the lean indicators mean, what the mirror will become over time. Subtle — sets the promise without being preachy.
- PWA manifest + install prompt on mobile (so it lives on their home screen like a native app)
- Methodology tooltip: tap a lean pill → quick popover explaining that axis in plain language (instead of sending them to /methodology cold)

**Success criteria:** A new user who sees the intro understands within 60 seconds why this is different from Inshorts.

---

## Build 7 — Saves + Follow Inbox
**Track 1**

Users have no way to bookmark articles or see updates on stories they follow. The Follow button exists on the timeline page but nothing happens after you press it.

**Scope:**
- **Saves:** Bookmark any article (auth-gated, stored in Supabase). Accessible from the "You" tab.
- **Follow inbox:** A "Following" section in the "You" tab listing all followed story clusters. Shows the latest source count and a "New" badge when a followed story has been updated since last viewed.
- **Web Push notifications:** Optional opt-in. When a followed story gains a new source, send a push notification. Pairs with the cluster_follows table already in place.

**Success criteria:** A user who follows a story and receives a push notification comes back to the app.

---

## Build 8 — Reading Profile (Mirror Foundation)
**Track 2**

The "You" tab is currently a sign-in/sign-out sheet. This build transforms it into the first version of the cognitive mirror — a personal reading profile that is meaningful even with limited data and grows richer over time.

**Scope:**
- Full-screen "You" page (replace the bottom sheet with a proper page)
- **Reading stats:** Articles read, sources tried, topics covered — this week and all-time
- **Source diversity bar:** A simple visual showing how many distinct sources the user has read from, colour-coded by lean direction across the 4 axes
- **Lean distribution:** A radar/bar chart showing where the user's aggregate reading sits across identity, state trust, economic, institutional axes — based on the scores of articles they've read
- **Topics breakdown:** Which topics dominate their reading vs what's available in the feed

**Design tone:** Curious, not judgmental. "Here's how you've been reading" not "you're biased." Show the data, let them draw their own conclusions.

**Dependencies:** Requires reading_events data. If the user has fewer than 10 read events, show a gentle "keep reading — your profile fills in as you go" state.

**Success criteria:** A user who opens their profile comes back to check it again the following week.

---

## Build 9 — Ambient Mirror in Feed
**Track 2**

The profile page is where users go to see the full mirror. This build adds the ambient layer — quiet signals woven into the reading experience itself that hint at patterns without interrupting the flow.

**Scope:**
- **Lean context on cards:** When a user has enough history (20+ read events), a subtle indicator on a card can show "this aligns with your usual reading" or "this is different from your usual sources" — one line, very quiet.
- **Periodic mirror card:** Every N sessions, a non-article card appears in the feed stack — not an ad, not a prompt — just a quiet reflection: "This week you've read mostly from state-deferential sources. Here's one that covers the same story differently." With a link to that alternative source's take.
- **Source nudge on timeline:** On the `/timeline/[id]` page, if a user consistently reads the same source's take, a subtle "you haven't read [Source X]'s take yet — they framed this differently" prompt.
- **Echo chamber indicator on topic pills:** A very subtle visual treatment on topic pills when a user's reading within that topic is skewing heavily one way.

**Design rule:** Every ambient signal must be opt-outable. Users who find it distracting can turn it off from the You page. Default is on.

**Success criteria:** At least one ambient signal prompts a user to read a source they wouldn't have otherwise opened.

---

## Build 10 — Search
**Track 1**

No news app can claim to be a replacement without search. This is the last major table-stakes gap.

**Scope:**
- Full-text search across article headlines and summaries
- Filter by source, topic tag, date range
- Results show the same ArticleCard list treatment as the feed
- Search from the feed topbar (tap the search icon)

**Note:** If Supabase full-text search (`to_tsvector`) is sufficient, use it. If result quality is poor, consider a simple Gemini-backed semantic search using the existing embeddings.

**Success criteria:** A user can find a specific story they remember reading 3 days ago in under 10 seconds.

---

## Build 11 — Weekly Digest
**Track 2**

A periodic in-app (and optional email) summary of the user's reading week. This is the highest-visibility version of the cognitive mirror — the moment most likely to create the "oh, huh" realisation.

**Scope:**
- **In-app digest card:** Appears in the feed on Monday mornings. Shows last week's reading: N articles, M sources, top topics, lean distribution shift vs previous week.
- **Optional email digest:** User opts in from the You page. Same content as in-app card, formatted for email.
- **Year-in-reading (future):** Spotify Wrapped equivalent — annual reading pattern summary. Flag for later.

**Success criteria:** A user shares their weekly digest with someone else.

---

## Feature Gaps Not Yet Scheduled

These are real gaps but not on the critical path yet. Revisit after Build 9:

- **Comments / discussion** — adds community but significant moderation cost
- **Language / regional filter** — Hindi sources are ingested; a language toggle would surface them intentionally
- **"Catch me up" mode** — returning user after 3 days: "here are the 5 stories that developed while you were away"
- **Article sharing** — share a card or timeline to WhatsApp/Instagram with a clean preview
- **Reading streaks / gamification** — lightweight retention mechanic; risk of feeling cheap if not done carefully
- **Source recommendation engine** — "based on your reading, you might like [Source]" — requires more reading event data first

---

## What Makes or Breaks This

The cognitive mirror only works if users read enough articles for the data to be meaningful. That means Track 1 (reading experience) is not just a nice-to-have — it is the prerequisite for Track 2 to deliver on its promise.

Build order follows this logic: get them in (Build 6: onboarding), keep them coming back (Build 7: saves + follow inbox), show them the mirror when there's enough to show (Build 8), then deepen it (Build 9), and close the table-stakes gap (Build 10).

The app wins when a user opens it and thinks: _"I don't need another app — and this one actually knows how I read."_
