-- Build 3C: Embeddings + Clustering
-- Run in Supabase SQL editor

-- 1. IVFFlat index for fast cosine similarity search
--    You have 12k+ articles so this is ready to create now.
--    lists=50 is appropriate for ~10k-100k vectors.
CREATE INDEX IF NOT EXISTS articles_embedding_idx
  ON articles
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- 2. Convenience view: cluster size + source count per cluster
--    Used by the feed to show "N sources covered this"
CREATE OR REPLACE VIEW cluster_summary AS
SELECT
  sc.id                                         AS cluster_id,
  sc.canonical_headline,
  sc.created_at,
  COUNT(DISTINCT ac.article_id)                 AS article_count,
  COUNT(DISTINCT a.source_id)                   AS source_count
FROM story_clusters sc
JOIN article_clusters ac ON ac.cluster_id = sc.id
JOIN articles a ON a.id = ac.article_id
GROUP BY sc.id, sc.canonical_headline, sc.created_at;

-- 3. Grant public read on the view (matches existing RLS policy intent)
GRANT SELECT ON cluster_summary TO anon, authenticated;
