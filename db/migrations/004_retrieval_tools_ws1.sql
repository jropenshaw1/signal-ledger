-- =============================================================================
-- Signal Ledger — Migration 004: Retrieval tools (WS-1)
-- Creates:
--   1. sl_vector_search() — RPC for semantic search via pgvector cosine similarity
--   2. content_type column on sl_articles (ADR-015 prep, default 'article')
--   3. evaluation_status, content_hash, last_scraped columns on sl_articles (ADR-016 prep)
--
-- These columns are added now because sl_search needs content_type for filtering,
-- and adding them in a later migration would require re-deploying the RPC.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add new columns to sl_articles (idempotent with IF NOT EXISTS pattern)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- content_type (ADR-015)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sl_articles' AND column_name = 'content_type'
  ) THEN
    ALTER TABLE sl_articles ADD COLUMN content_type text NOT NULL DEFAULT 'article';
    ALTER TABLE sl_articles ADD CONSTRAINT chk_content_type
      CHECK (content_type IN ('article', 'prompt_kit'));
  END IF;

  -- evaluation_status (ADR-016)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sl_articles' AND column_name = 'evaluation_status'
  ) THEN
    ALTER TABLE sl_articles ADD COLUMN evaluation_status text NOT NULL DEFAULT 'unevaluated';
    ALTER TABLE sl_articles ADD CONSTRAINT chk_evaluation_status
      CHECK (evaluation_status IN ('unevaluated', 'evaluated'));
  END IF;

  -- content_hash (ADR-016)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sl_articles' AND column_name = 'content_hash'
  ) THEN
    ALTER TABLE sl_articles ADD COLUMN content_hash text;
  END IF;

  -- last_scraped (ADR-016)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sl_articles' AND column_name = 'last_scraped'
  ) THEN
    ALTER TABLE sl_articles ADD COLUMN last_scraped timestamptz;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. sl_vector_search — RPC for semantic similarity search
-- ---------------------------------------------------------------------------

-- query_embedding is text so PostgREST / supabase-js reliably binds JSON string payloads
-- (e.g. "[0.1,0.2,...]") to PostgreSQL; cast to vector inside the function body.
-- model filter matches sl_embed_article + _shared/embedding_client.ts (text-embedding-3-small).
CREATE OR REPLACE FUNCTION sl_vector_search(
  query_embedding      text,
  result_limit         integer DEFAULT 5,
  filter_content_type  text    DEFAULT NULL,
  filter_provider_id   uuid    DEFAULT NULL,
  filter_date_from     date    DEFAULT NULL,
  filter_date_to       date    DEFAULT NULL
)
RETURNS TABLE (
  article_id           uuid,
  title                text,
  published_date       date,
  content_type         text,
  provider_id          uuid,
  provider_name        text,
  capture_completeness text,
  chunk_index          integer,
  chunk_text           text,
  similarity           double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT query_embedding::vector(1536) AS qemb
  ),
  ranked AS (
    SELECT
      a.article_id      AS article_id,
      a.title,
      a.published_date,
      COALESCE(a.content_type, 'article') AS content_type,
      a.provider_id,
      p.provider_name,
      a.capture_completeness,
      e.chunk_index,
      e.chunk_text,
      1 - (e.embedding <=> q.qemb) AS similarity,
      ROW_NUMBER() OVER (
        PARTITION BY a.article_id
        ORDER BY (e.embedding <=> q.qemb) ASC
      ) AS rn
    FROM sl_signpost_embeddings e
    CROSS JOIN q
    JOIN sl_articles a ON a.article_id = e.article_id
    LEFT JOIN sl_provider_records p ON p.provider_id = a.provider_id
    WHERE a.embedding_status = 'complete'
      AND e.model_id = 'text-embedding-3-small'
      AND (filter_content_type IS NULL OR COALESCE(a.content_type, 'article') = filter_content_type)
      AND (filter_provider_id  IS NULL OR a.provider_id = filter_provider_id)
      AND (filter_date_from    IS NULL OR a.published_date >= filter_date_from)
      AND (filter_date_to      IS NULL OR a.published_date <= filter_date_to)
  )
  SELECT
    article_id,
    title,
    published_date,
    content_type,
    provider_id,
    provider_name,
    capture_completeness,
    chunk_index,
    chunk_text,
    similarity
  FROM ranked
  WHERE rn = 1
  ORDER BY similarity DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION sl_vector_search(text, integer, text, uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. sl_kit_evaluations table (ADR-016) — created now for completeness
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sl_kit_evaluations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            uuid NOT NULL REFERENCES sl_articles(article_id),
  evaluator             text NOT NULL,
  evaluation_type       text NOT NULL DEFAULT 'fit-to-current-work'
    CHECK (evaluation_type IN (
      'fit-to-current-work',
      'periodic-review',
      'triggered-evaluation',
      'experimental-run',
      'deprecated'
    )),
  score                 numeric,
  notes                 text,
  evaluated_content_hash text,
  evaluated_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kit_eval_article ON sl_kit_evaluations(article_id);
CREATE INDEX IF NOT EXISTS idx_kit_eval_type ON sl_kit_evaluations(evaluation_type);
