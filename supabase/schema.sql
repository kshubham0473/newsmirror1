-- NewsMirror Schema
-- Run this in your Supabase SQL editor

-- Enable pgvector for story clustering (Build 2)
create extension if not exists vector;

-- ─── SOURCES ──────────────────────────────────────────────────────────────────
create table sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  rss_url     text not null unique,
  home_url    text not null,
  language    text not null default 'en',       -- 'en', 'hi', 'mr', etc.
  created_at  timestamptz not null default now()
);

-- ─── ARTICLES ─────────────────────────────────────────────────────────────────
create table articles (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id) on delete cascade,
  url           text not null unique,
  headline      text not null,
  body          text,
  summary       text,                            -- Gemini Flash output
  image_url     text,
  published_at  timestamptz,
  ingested_at   timestamptz not null default now(),
  topic_tags    text[] default '{}',             -- ['politics','economy',...]
  embedding     vector(768),                     -- for story clustering (Build 2)
  -- Build 3 scores (nullable until classifier runs)
  identity_score      float,
  state_trust_score   float,
  economic_score      float,
  institution_score   float,
  classifier_rationale jsonb
);

-- Indexes
create index articles_source_id_idx     on articles(source_id);
create index articles_published_at_idx  on articles(published_at desc);
create index articles_topic_tags_idx    on articles using gin(topic_tags);
-- pgvector index (Build 2) — add after you have >1000 articles
-- create index articles_embedding_idx on articles using ivfflat (embedding vector_cosine_ops) with (lists = 50);

-- ─── STORY CLUSTERS (Build 2) ─────────────────────────────────────────────────
create table story_clusters (
  id                  uuid primary key default gen_random_uuid(),
  canonical_headline  text not null,
  topic               text,
  created_at          timestamptz not null default now()
);

create table article_clusters (
  article_id  uuid not null references articles(id) on delete cascade,
  cluster_id  uuid not null references story_clusters(id) on delete cascade,
  primary key (article_id, cluster_id)
);

-- ─── USER PREFERENCES (Build 2) ───────────────────────────────────────────────
create table user_preferences (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  topic_filters text[] default '{}',
  updated_at    timestamptz not null default now()
);

-- ─── SOURCE IDEOLOGY SCORES (Build 3) ─────────────────────────────────────────
create table source_ideology_scores (
  id                    uuid primary key default gen_random_uuid(),
  source_id             uuid not null references sources(id) on delete cascade,
  constraint source_ideology_scores_source_id_unique unique (source_id),
  scored_at             timestamptz not null default now(),
  identity_score        float not null,
  state_trust_score     float not null,
  economic_score        float not null,
  institution_score     float not null,
  article_sample_count  int not null default 0,
  rationale             jsonb
);

create index source_ideology_source_id_idx on source_ideology_scores(source_id, scored_at desc);

-- ─── READING EVENTS (Build 4) ─────────────────────────────────────────────────
create table reading_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,
  article_id          uuid not null references articles(id) on delete cascade,
  source_id           uuid not null references sources(id) on delete cascade,
  read_at             timestamptz not null default now(),
  time_spent_seconds  int default 0,
  completed           boolean default false
);

create index reading_events_user_id_idx on reading_events(user_id, read_at desc);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table sources            enable row level security;
alter table articles           enable row level security;
alter table story_clusters     enable row level security;
alter table article_clusters   enable row level security;
alter table user_preferences   enable row level security;
alter table source_ideology_scores enable row level security;
alter table reading_events     enable row level security;

-- Sources and articles are public-read
create policy "sources are public" on sources for select using (true);
create policy "articles are public" on articles for select using (true);
create policy "clusters are public" on story_clusters for select using (true);
create policy "article_clusters are public" on article_clusters for select using (true);
create policy "ideology scores are public" on source_ideology_scores for select using (true);

-- User data is private
create policy "users own preferences" on user_preferences
  for all using (auth.uid() = user_id);

create policy "users own reading events" on reading_events
  for all using (auth.uid() = user_id);

-- Service role can write everything (for Edge Functions)
create policy "service can write sources" on sources
  for all using (auth.role() = 'service_role');
create policy "service can write articles" on articles
  for all using (auth.role() = 'service_role');
create policy "service can write ideology scores" on source_ideology_scores
  for all using (auth.role() = 'service_role');
