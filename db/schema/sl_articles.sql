-- =============================================================================
-- Signal Ledger: sl_articles
-- Primary artifact table. One row per ingested article — current best state.
-- Canonical signpost metadata lives in structured_signposts (JSONB).
-- sl_capture_events holds the immutable audit trail of how each row evolved.
-- Dependencies: sl_provider_records
-- =============================================================================

-- Requires pgvector
-- CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- AM-04 JSONB shape validators
-- Called by CHECK constraints below. IMMUTABLE so Postgres can inline them.
-- Enforcement is DB-layer (ruling 2026-05-01, decision 1A).
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_signpost_entries(arr jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF arr IS NULL THEN RETURN true; END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(arr) AS e
        WHERE e->>'signpost_id'       IS NULL
           OR e->>'extraction_method' IS NULL
           OR e->>'extracted_at'      IS NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION validate_claim_entries(arr jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF arr IS NULL THEN RETURN true; END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(arr) AS e
        WHERE e->>'claim_id'          IS NULL
           OR e->>'extraction_method' IS NULL
           OR e->>'extracted_at'      IS NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION validate_technical_block_entries(arr jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF arr IS NULL THEN RETURN true; END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(arr) AS e
        WHERE e->>'block_id'          IS NULL
           OR e->>'extraction_method' IS NULL
           OR e->>'extracted_at'      IS NULL
    );
END;
$$;

CREATE TABLE IF NOT EXISTS sl_articles (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    article_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    provider_id             uuid        NOT NULL
                                        REFERENCES sl_provider_records (provider_id)
                                        ON DELETE RESTRICT,

    -- ------------------------------------------------------------------
    -- Classification
    -- ------------------------------------------------------------------

    -- V1 content types. Extend check constraint when new plugins added.
    -- Historical executive briefings captured pre-2026-04-29 carry
    -- capture_completeness = 'preview-only'; content_type remains
    -- 'Nate-executive-briefing' — the retired preview type is not used.
    content_type            text        NOT NULL,

    -- ------------------------------------------------------------------
    -- Source metadata
    -- ------------------------------------------------------------------
    title                   text        NOT NULL,

    -- Immutable provenance (Charter P3). Never updated after first write.
    published_date          date        NOT NULL,

    ingestion_date          timestamptz NOT NULL DEFAULT now(),

    ingestion_source        text        NOT NULL,

    -- complete       = full body captured as published
    -- preview-only   = paywall-gated; excerpt only (source access, not system failure)
    -- partial        = degraded capture; retry warranted
    capture_completeness    text        NOT NULL,

    -- Canonical Substack URL. Null permitted for email-backfill records
    -- where URL is unresolvable at time of capture.
    url                     text,

    -- ------------------------------------------------------------------
    -- Body
    -- ------------------------------------------------------------------

    -- Full article body, verbatim. Non-null when capture_completeness != 'preview-only'.
    body_text               text,

    -- ------------------------------------------------------------------
    -- Article-level embedding (coarse retrieval filter)
    -- Precision retrieval goes through sl_signpost_embeddings.
    -- Provenance fields required — Decision 5 (embedding lock).
    -- ------------------------------------------------------------------
    embedding               vector(1536),
    embedding_model         text,
    embedding_version       text,

    -- SHA-256 of body_text. Idempotent re-embedding: skip if hash matches,
    -- upsert if changed. Same pattern as sl_signpost_embeddings.
    content_hash            text,

    -- ------------------------------------------------------------------
    -- Structured signposts (canonical JSONB — Decision 6, AM-04, column naming ruling)
    -- Replaces data dictionary's author_signposts Array<String>.
    -- signpost_id is written simultaneously to this array and to
    -- sl_signpost_embeddings at ingestion time. Never recomputed.
    --
    -- Object shape:
    -- {
    --   "signpost_id":        "uuid",
    --   "signpost_text":      "...",
    --   "extraction_method":  "verbatim" | "a2-extracted" | "a2-paraphrased",
    --   "extracted_at":       "ISO 8601 UTC"
    -- }
    -- ------------------------------------------------------------------
    structured_signposts    jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- ------------------------------------------------------------------
    -- Cited claims (JSONB array of E1a objects — AM-04 sub-entry IDs added)
    --
    -- Object shape:
    -- {
    --   "claim_id":           "uuid",
    --   "claim_text":         "...",
    --   "attributed_to":      "..." | null,
    --   "claim_type":         "statistic" | "assertion" | "prediction" | "attribution",
    --   "extraction_method":  "verbatim" | "a2-extracted" | "a2-paraphrased",
    --   "extracted_at":       "ISO 8601 UTC"
    -- }
    -- ------------------------------------------------------------------
    cited_claims            jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- ------------------------------------------------------------------
    -- Structured technical content (JSONB array of E1b objects — AM-04 sub-entry IDs added)
    --
    -- Object shape:
    -- {
    --   "block_id":           "uuid",
    --   "block_name":         "...",
    --   "block_type":         "framework" | "model" | "methodology" | "taxonomy" | "heuristic",
    --   "block_content":      "...",
    --   "kit_candidate":      boolean,
    --   "extraction_method":  "verbatim" | "a2-extracted" | "a2-paraphrased",
    --   "extracted_at":       "ISO 8601 UTC"
    -- }
    -- ------------------------------------------------------------------
    structured_technical_content jsonb  NOT NULL DEFAULT '[]'::jsonb,

    -- ------------------------------------------------------------------
    -- Timestamps
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    -- ------------------------------------------------------------------
    -- Embedding pipeline lifecycle
    -- Nullable by design: preview-only articles (no body_text) never
    -- receive an embedding and carry NULL throughout their lifetime.
    -- complete/partial articles receive 'pending' via explicit UPDATE
    -- after article commit (Functional Spec v1.0 Appendix A, step 5).
    -- State machine: pending → processing → complete | failed.
    -- 3 total attempts: Attempt 1 → wait 2s → Attempt 2 → wait 8s →
    -- Attempt 3 → terminal. Managed entirely by the async embedding worker.
    -- Functional Spec v1.0 §2; migration 001; 2026-05-01.
    -- ------------------------------------------------------------------
    embedding_status        text,

    -- ------------------------------------------------------------------
    -- Constraints
    -- ------------------------------------------------------------------
    CONSTRAINT ck_sla_content_type
        CHECK (content_type IN ('Nate-feature-article', 'Nate-executive-briefing')),

    CONSTRAINT ck_sla_ingestion_source
        CHECK (ingestion_source IN ('web', 'email-backfill')),

    CONSTRAINT ck_sla_capture_completeness
        CHECK (capture_completeness IN ('complete', 'preview-only', 'partial')),

    -- preview-only rows must have NULL body_text (excerpt not stored here).
    -- complete and partial rows must carry a non-null body_text.
    -- Ruling 2026-05-01, decision 2B.
    CONSTRAINT ck_sla_body_text_completeness
        CHECK (
            (capture_completeness = 'preview-only'            AND body_text IS NULL)
            OR (capture_completeness IN ('complete', 'partial') AND body_text IS NOT NULL)
        ),

    -- Embedding provenance fields travel together.
    CONSTRAINT ck_sla_embedding_provenance
        CHECK (
            (embedding IS NULL AND embedding_model IS NULL AND embedding_version IS NULL AND content_hash IS NULL)
            OR
            (embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedding_version IS NOT NULL AND content_hash IS NOT NULL)
        ),

    CONSTRAINT ck_sla_content_hash_format
        CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),

    CONSTRAINT ck_sla_embedding_version_format
        CHECK (embedding_version IS NULL OR embedding_version ~ '^[^/]+/[^/]+/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]+$'),

    -- AM-04: array type + required sub-entry fields enforced at DB layer.
    -- Ruling 2026-05-01, decision 1A.
    CONSTRAINT ck_sla_structured_signposts_is_array
        CHECK (jsonb_typeof(structured_signposts) = 'array'),

    CONSTRAINT ck_sla_signposts_shape
        CHECK (validate_signpost_entries(structured_signposts)),

    CONSTRAINT ck_sla_cited_claims_is_array
        CHECK (jsonb_typeof(cited_claims) = 'array'),

    CONSTRAINT ck_sla_claims_shape
        CHECK (validate_claim_entries(cited_claims)),

    CONSTRAINT ck_sla_structured_technical_content_is_array
        CHECK (jsonb_typeof(structured_technical_content) = 'array'),

    CONSTRAINT ck_sla_technical_shape
        CHECK (validate_technical_block_entries(structured_technical_content)),

    -- Orphan embedding guard: embedding may not exist without source text.
    -- Ruling 2026-05-01, decision 3bA.
    CONSTRAINT ck_sla_embedding_requires_body
        CHECK (embedding IS NULL OR body_text IS NOT NULL),

    -- embedding_status value domain (Functional Spec §2)
    CONSTRAINT ck_sla_embedding_status
        CHECK (
            embedding_status IS NULL
            OR embedding_status IN ('pending', 'processing', 'complete', 'failed')
        ),

    -- Coherence: embedding vector present → pipeline completed successfully.
    -- 'complete' is the only valid terminal-success state.
    CONSTRAINT ck_sla_embedding_status_complete
        CHECK (embedding IS NULL OR embedding_status = 'complete'),

    -- Coherence: preview-only rows have NULL body_text; embedding never applies.
    -- 'pending' on a preview-only row is a logic error, not a deferred state.
    CONSTRAINT ck_sla_embedding_status_preview_null
        CHECK (capture_completeness != 'preview-only' OR embedding_status IS NULL),

    -- One canonical article per provider per title per published date.
    -- Prevents duplicate ingestion of the same article.
    CONSTRAINT uq_sla_provider_title_date
        UNIQUE (provider_id, title, published_date)

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- HNSW for article-level semantic retrieval (coarse filter).
CREATE INDEX IF NOT EXISTS idx_sla_embedding_hnsw
    ON sl_articles
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding IS NOT NULL;

-- B-tree on published_date for targeted and audit retrieval.
CREATE INDEX IF NOT EXISTS idx_sla_published_date
    ON sl_articles (published_date);

-- Composite for filtered retrieval by provider and content type.
CREATE INDEX IF NOT EXISTS idx_sla_provider_content_type
    ON sl_articles (provider_id, content_type);

-- Partial index covering only rows the embedding worker queries.
-- 'complete' rows excluded — they need no further action.
-- 'processing' included to support stale-processing recovery sweeps.
CREATE INDEX IF NOT EXISTS idx_sla_embedding_status
    ON sl_articles (embedding_status, updated_at)
    WHERE embedding_status IN ('pending', 'processing', 'failed');

-- B-tree on capture_completeness for audit queries.
CREATE INDEX IF NOT EXISTS idx_sla_capture_completeness
    ON sl_articles (capture_completeness);

-- B-tree on provider_id for provider-scoped article retrieval.
CREATE INDEX IF NOT EXISTS idx_sla_provider_id
    ON sl_articles (provider_id);

-- =============================================================================
-- updated_at trigger
-- =============================================================================

DROP TRIGGER IF EXISTS trg_sla_updated_at ON sl_articles;

CREATE TRIGGER trg_sla_updated_at
    BEFORE UPDATE ON sl_articles
    FOR EACH ROW
    EXECUTE FUNCTION sl_set_updated_at();

-- =============================================================================
-- RLS placeholder
-- =============================================================================
-- ALTER TABLE sl_articles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_articles IS
    'Primary artifact table. One row per ingested article — current best state. '
    'sl_capture_events holds the immutable audit trail of how each row evolved. '
    'structured_signposts is the canonical JSONB field (supersedes data dictionary '
    'author_signposts Array<String> — column naming ruling 2026-05-01). '
    'signpost_id values are written simultaneously here and to sl_signpost_embeddings.';

COMMENT ON COLUMN sl_articles.structured_signposts IS
    'Canonical signpost JSONB. Each object carries signpost_id (stable UUID), '
    'signpost_text, extraction_method, and extracted_at. signpost_id is '
    'written simultaneously to sl_signpost_embeddings at ingestion time.';

COMMENT ON COLUMN sl_articles.embedding IS
    'Article-level embedding — coarse retrieval filter only. '
    'Precision retrieval goes through sl_signpost_embeddings. '
    'Null until embedding pipeline runs. Provenance fields '
    '(embedding_model, embedding_version, content_hash) travel with it.';

COMMENT ON COLUMN sl_articles.embedding_status IS
    'Async embedding pipeline lifecycle state. '
    'NULL for preview-only articles (no body_text → embedding never applies). '
    'State machine: pending → processing → complete | failed. '
    '3 total attempts: Attempt 1 → wait 2s → Attempt 2 → wait 8s → Attempt 3 → terminal. '
    'Set to ''pending'' by application after article commit (Appendix A, step 5). '
    'Advanced by the async embedding worker. '
    'Functional Spec v1.0 §2; migration 001; 2026-05-01.';

COMMENT ON COLUMN sl_articles.published_date IS
    'Date of original publication. Immutable provenance (Charter P3). '
    'Never updated after first write regardless of subsequent enrichment.';
