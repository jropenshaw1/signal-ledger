-- =============================================================================
-- Migration 001: embedding_status lifecycle + event_type constraint alignment
-- Implements: Functional Spec v1.0, Step 1 of implementation sequence
-- Applied to: sl_articles, sl_capture_events
-- Date: 2026-05-01
--
-- Changes:
--   A. sl_articles — add embedding_status column + 3 integrity constraints + index
--   B. sl_capture_events — replace event_type constraint to match spec §3 taxonomy
--
-- Defect note (1B):
--   The DDL's original event_type constraint carried a pre-spec taxonomy
--   ('web-ingest', 'email-backfill', 'retry', 'enrichment', 'supersession',
--   'audit-detection'). The functional spec §3 defines 7 pipeline-stage event
--   types that do not overlap with that set. Every event write in Steps 2–8
--   would have violated the old constraint. Fixed here before implementation
--   proceeds.
-- =============================================================================


-- =============================================================================
-- A. sl_articles — embedding_status lifecycle column
-- =============================================================================

-- Column is nullable by design:
--   - preview-only articles have no body_text → embedding never applies → NULL
--   - complete/partial articles receive 'pending' via explicit UPDATE
--     after article commit (Functional Spec v1.0 Appendix A, step 5)
--   - DEFAULT is intentionally omitted; the application sets this explicitly

ALTER TABLE sl_articles
    ADD COLUMN IF NOT EXISTS embedding_status text;


-- Value domain: the four lifecycle states defined in Functional Spec §2
ALTER TABLE sl_articles
    ADD CONSTRAINT ck_sla_embedding_status
        CHECK (
            embedding_status IS NULL
            OR embedding_status IN ('pending', 'processing', 'complete', 'failed')
        );


-- Coherence: if an embedding vector is present, the pipeline must have
-- completed successfully. 'complete' is the only valid terminal-success state.
ALTER TABLE sl_articles
    ADD CONSTRAINT ck_sla_embedding_status_complete
        CHECK (embedding IS NULL OR embedding_status = 'complete');


-- Coherence: preview-only rows have NULL body_text and therefore no embedding.
-- embedding_status must also be NULL — 'pending' on a preview-only row is a
-- logic error, not a deferred state.
ALTER TABLE sl_articles
    ADD CONSTRAINT ck_sla_embedding_status_preview_null
        CHECK (capture_completeness != 'preview-only' OR embedding_status IS NULL);


-- Index: partial index covering only rows the embedding worker cares about.
-- 'complete' rows are excluded — they need no further action.
-- 'processing' included so stale-processing recovery queries are covered.
CREATE INDEX IF NOT EXISTS idx_sla_embedding_status
    ON sl_articles (embedding_status, updated_at)
    WHERE embedding_status IN ('pending', 'processing', 'failed');


COMMENT ON COLUMN sl_articles.embedding_status IS
    'Async embedding pipeline lifecycle state. '
    'NULL for preview-only articles (no body_text → embedding never applies). '
    'State machine: pending → processing → complete | failed. '
    'Three total attempts: Attempt 1 → wait 2s → Attempt 2 → wait 8s → '
    'Attempt 3 → terminal. Set to ''pending'' by application after article '
    'commit; advanced by the async embedding worker. '
    'Functional Spec v1.0 §2; implementation-binding 2026-05-01.';


-- =============================================================================
-- B. sl_capture_events — event_type constraint alignment
-- =============================================================================
-- Drop the pre-spec constraint and replace with the 7 pipeline-stage types
-- defined in Functional Spec §3. The old taxonomy classified the capture
-- *method* (web-ingest, email-backfill); the spec taxonomy classifies the
-- *pipeline stage* (ingestion_started, embedding_queued, etc.).
-- ingestion_source on the same table continues to carry the method.

ALTER TABLE sl_capture_events
    DROP CONSTRAINT IF EXISTS ck_sce_event_type,
    ADD CONSTRAINT ck_sce_event_type
        CHECK (event_type IN (
            'ingestion_started',
            'ingestion_succeeded',
            'ingestion_failed',
            'embedding_queued',
            'embedding_succeeded',
            'embedding_failed',
            'retry_attempted'
        ));


-- =============================================================================
-- Verification queries (run manually after applying migration)
-- =============================================================================

-- 1. Confirm embedding_status column exists with correct constraint
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'sl_articles' AND column_name = 'embedding_status';

-- 2. Confirm all three integrity constraints are present
-- SELECT constraint_name
--   FROM information_schema.table_constraints
--  WHERE table_name = 'sl_articles'
--    AND constraint_name LIKE 'ck_sla_embedding_status%';

-- 3. Confirm the index was created
-- SELECT indexname, indexdef
--   FROM pg_indexes
--  WHERE tablename = 'sl_articles' AND indexname = 'idx_sla_embedding_status';

-- 4. Confirm new event_type constraint is live
-- SELECT constraint_name, check_clause
--   FROM information_schema.check_constraints
--  WHERE constraint_name = 'ck_sce_event_type';

-- 5. Spot-check: preview-only article must reject non-null embedding_status
-- INSERT INTO sl_articles (..., capture_completeness, embedding_status)
--   VALUES (..., 'preview-only', 'pending')  -- should violate ck_sla_embedding_status_preview_null

-- 6. Spot-check: complete article with embedding must accept only 'complete' status
-- UPDATE sl_articles SET embedding_status = 'pending'
--  WHERE embedding IS NOT NULL;  -- should violate ck_sla_embedding_status_complete
