# NewsMirror — Build 1

Clean Indian news, summarised and in perspective.

## Stack
- **Frontend**: Next.js 14 (App Router) · TypeScript · CSS Modules
- **Backend**: Supabase (Postgres + pgvector + Edge Functions)
- **AI**: Gemini 1.5 Flash (summarisation + topic tagging)
- **Hosting**: Vercel
- **PWA**: next-pwa

---

## Setup — do this in order

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase/schema.sql`
3. Then paste and run `supabase/seed.sql` to add starter sources
4. Go to **Settings → API** — copy your `Project URL` and `anon key` and `service_role key`

### 2. Gemini

1. Go to [aistudio.google.com](https://aistudio.google.com) → **API Keys** → create a key
2. Copy it — you'll use it as `GEMINI_API_KEY`

### 3. Environment variables

```bash
cp .env.example .env.local
# Fill in all four values
```

Add the same variables to **Vercel Dashboard → Settings → Environment Variables** when you deploy.

Also add:
```
INGEST_SECRET=any-random-string-you-choose
```

### 4. Deploy the Edge Function

Install Supabase CLI if you haven't:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set secrets on the function:
```bash
supabase secrets set GEMINI_API_KEY=your-key-here
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Deploy:
```bash
supabase functions deploy ingest-articles
```

### 5. Schedule the cron (Supabase Dashboard)

Go to **Edge Functions → ingest-articles → Schedules**
Add schedule: `*/30 * * * *` (every 30 minutes)

### 6. Run locally

```bash
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 7. Trigger first ingest manually

```bash
curl -H "x-ingest-secret: your-ingest-secret" \
  http://localhost:3000/api/ingest
```

Or after deploying to Vercel:
```bash
curl -H "x-ingest-secret: your-ingest-secret" \
  https://your-app.vercel.app/api/ingest
```

Wait 30–60 seconds, then refresh the feed.

### 8. Deploy to Vercel

```bash
# Push to GitHub first, then:
npx vercel --prod
```

Or connect your GitHub repo in the Vercel dashboard.

---

## Adding/updating sources

Just insert rows into the `sources` table in Supabase:

```sql
insert into sources (name, rss_url, home_url, language)
values ('NewsSource', 'https://example.com/rss', 'https://example.com', 'en');
```

The next ingest cron will pick it up automatically.

---

## Build roadmap

| Build | What's added |
|-------|-------------|
| **1 — Reader** *(you are here)* | RSS ingest · Gemini summaries · Clean feed · Topic pills |
| **2 — Filter** | Story clustering · User auth · Saved preferences |
| **3 — Classifier** | 4-axis ideology scoring · Source profiles |
| **4 — Mirror** | Reading events · Perspective radar · Weekly nudge digest |
