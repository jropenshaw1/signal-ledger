-- =============================================================================
-- Signal Ledger: sl_signpost_embeddings
-- Flat retrieval surface for per-signpost vector search.
-- Canonical signpost metadata lives in sl_articles.structured_signposts (JSONB).
-- This table is the denormalized read layer; writes must be atomic or
-- rebuildable via content_hash.
-- =============================================================================

-- Requires pgvector (already enabled on Supabase projects by default)
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sl_signpost_embeddings (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    signpost_embedding_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK to sl_articles; cascade on delete rebuilds clean (no orphaned rows)
    article_id              uuid        NOT NULL
                                        REFERENCES sl_articles (article_id)
                                        ON DELETE CASCADE,

    -- Stable identifier written simultaneously to this row AND to the JSONB
    -- entry in sl_articles.structured_signposts. Never recomputed after first
    -- write — the JSONB entry is the source of truth for provenance.
    signpost_id             uuid        NOT NULL,

    -- ------------------------------------------------------------------
    -- Signpost content
    -- ------------------------------------------------------------------

    -- Duplicated from JSONB for retrieval locality; avoids JSONB parse on
    -- every vector search result hydration.
    signpost_text           text        NOT NULL,

    -- 1-based ordinal preserving signpost sequence within the article.
    -- Derived from JSONB array index at write time; never inferred at read.
    signpost_position       integer     NOT NULL,

    -- SHA-256 of signpost_text. Enables idempotent re-embedding: if the
    -- hash matches an existing row for (article_id, signpost_id), skip.
    -- Recalculate and upsert only when hash differs (text was edited).
    content_hash            text        NOT NULL,

    -- ------------------------------------------------------------------
    -- Embedding provenance
    -- ------------------------------------------------------------------

    -- "nate" in v1; field is multi-provider ready.
    provider_id             text        NOT NULL,

    -- Raw model identifier as returned by the embedding API.
    embedding_model         text        NOT NULL,

    -- Composite version string for lineage tracking and cache invalidation.
    -- Format: {provider}/{model_name}/{release_date}/{internal_increment}
    -- Example: nate/text-embedding-3-small/2024-01-25/001
    embedding_version       text        NOT NULL,

    -- ------------------------------------------------------------------
    -- The vector
    -- ------------------------------------------------------------------

    -- 1536 dimensions = OpenAI text-embedding-3-small / ada-002 default.
    -- If a different provider produces a different dimension, add a new
    -- provider block rather than widening this column.
    embedding               vector(1536) NOT NULL,

    -- ------------------------------------------------------------------
    -- Timestamps
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    -- ------------------------------------------------------------------
    -- Constraints
    -- ------------------------------------------------------------------

    -- Prevent duplicate embeddings for the same (article, signpost, provider).
    -- A signpost can be re-embedded under a new embedding_version, but only
    -- one active row per provider per signpost.
    CONSTRAINT uq_signpost_provider
        UNIQUE (signpost_id, provider_id),

    -- content_hash must be a valid hex SHA-256 (64 chars).
    CONSTRAINT ck_content_hash_format
        CHECK (content_hash ~ '^[0-9a-f]{64}$'),

    -- signpost_position is 1-based.
    CONSTRAINT ck_signpost_position_positive
        CHECK (signpost_position >= 1),

    -- embedding_version must match expected format.
    CONSTRAINT ck_embedding_version_format
        CHECK (embedding_version ~ '^[^/]+/[^/]+/[^/]+/[0-9]+$')

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- HNSW index for approximate nearest-neighbor vector search.
-- m=16 / ef_construction=64 are pgvector defaults; tune up for higher recall.
-- cosine distance is appropriate for normalized OpenAI embeddings.
CREATE INDEX IF NOT EXISTS idx_sle_embedding_hnsw
    ON sl_signpost_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Btree on article_id for per-article signpost retrieval and JOIN performance.
CREATE INDEX IF NOT EXISTS idx_sle_article_id
    ON sl_signpost_embeddings (article_id);

-- Btree on provider_id for multi-provider filtered queries and fan-out reads.
CREATE INDEX IF NOT EXISTS idx_sle_provider_id
    ON sl_signpost_embeddings (provider_id);

-- Composite: article + position for ordered retrieval of all signposts in an
-- article without JSONB parsing. Covers "give me all signposts for article X
-- in reading order."
CREATE INDEX IF NOT EXISTS idx_sle_article_position
    ON sl_signpost_embeddings (article_id, signpost_position);

-- content_hash lookup for idempotent re-embedding pipeline.
CREATE INDEX IF NOT EXISTS idx_sle_content_hash
    ON sl_signpost_embeddings (content_hash);

-- =============================================================================
-- updated_at trigger (Supabase-compatible)
-- =============================================================================

CREATE OR REPLACE FUNCTION sl_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sle_updated_at
    BEFORE UPDATE ON sl_signpost_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION sl_set_updated_at();

-- =============================================================================
-- RLS placeholder (enable when row-level access control is needed)
-- =============================================================================
-- ALTER TABLE sl_signpost_embeddings ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_signpost_embeddings IS
    'Flat retrieval surface for signpost-level vector search. '
    'Canonical signpost data lives in sl_articles.structured_signposts (JSONB). '
    'This table is a denormalized projection — rebuild from JSONB is safe and '
    'deterministic via content_hash.';

COMMENT ON COLUMN sl_signpost_embeddings.signpost_id IS
    'UUID generated at first write, stamped simultaneously into the JSONB '
    'entry in sl_articles.structured_signposts. Never recomputed.';

COMMENT ON COLUMN sl_signpost_embeddings.content_hash IS
    'SHA-256 of signpost_text. The embedding pipeline checks this before '
    'calling the embedding API — skip if hash matches, upsert if changed.';

COMMENT ON COLUMN sl_signpost_embeddings.embedding_version IS
    'Composite version string: {provider}/{model_name}/{release_date}/{increment}. '
    'Example: nate/text-embedding-3-small/2024-01-25/001. '
    'Changing the model or increment triggers a full re-embed sweep.';
