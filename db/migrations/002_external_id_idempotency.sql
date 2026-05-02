-- =============================================================================
-- Migration 002: external_id idempotency key on sl_articles
-- Implements: Functional Spec v1.0, Step 4 of implementation sequence
-- Applied to: sl_articles
-- Date: 2026-05-01
--
-- Changes:
--   A. sl_articles — add external_id column (nullable text)
--   B. sl_articles — add uq_sla_provider_external_id unique constraint
--
-- Design rationale:
--   external_id is the source-system identifier for an article, scoped by
--   provider_id. It makes (provider_id, external_id) a durable idempotency
--   key that survives title edits and date corrections.
--
--   Email-backfill ingest contract (enforced by application, not DB):
--     Prefer  → external_id = 'email:<RFC-2822-Message-ID>'
--     Fallback → external_id = 'email_hash:<sha256(normalized_title+body)>'
--     NULL     → only when no stable identifier can be derived (rare/transitional)
--
--   NULL semantics:
--     Postgres UNIQUE treats NULL as distinct from every other value, including
--     other NULLs. Two rows with (same provider_id, NULL external_id) satisfy
--     the constraint — they do not collide. This is the documented gap for
--     preview-only email records that lack both a Message-ID and body_text.
--     Application code must document this gap at the call site.
--
--   Web ingestion (Step 5):
--     external_id will carry a URL-derived or canonical identifier. The column
--     is added now so Step 5 can populate it without a schema change.
-- =============================================================================


-- =============================================================================
-- A. sl_articles — external_id column
-- =============================================================================

-- Nullable by design: see NULL semantics above.
-- No DEFAULT — application sets this explicitly or leaves it NULL.

ALTER TABLE sl_articles
    ADD COLUMN IF NOT EXISTS external_id text;


-- =============================================================================
-- B. sl_articles — idempotency unique constraint
-- =============================================================================

-- Covers only non-NULL pairs: two NULL rows for the same provider do NOT
-- collide (standard Postgres UNIQUE NULL behaviour). This is intentional;
-- see NULL semantics above.

ALTER TABLE sl_articles
    ADD CONSTRAINT uq_sla_provider_external_id
        UNIQUE (provider_id, external_id);


-- Partial index to accelerate external_id lookups on the non-NULL subset,
-- which is the hot path for duplicate detection.
CREATE INDEX IF NOT EXISTS idx_sla_provider_external_id
    ON sl_articles (provider_id, external_id)
    WHERE external_id IS NOT NULL;


COMMENT ON COLUMN sl_articles.external_id IS
    'Source-system identifier for the article, scoped by provider_id. '
    'Semantics: "email:<RFC-2822-Message-ID>" for email-sourced records; '
    '"email_hash:<sha256(normalized_title+body)>" when Message-ID is unavailable; '
    'NULL only when no stable identifier can be derived (preview-only + no Message-ID). '
    'Together with provider_id, forms the durable idempotency key '
    'enforced by uq_sla_provider_external_id. '
    'Functional Spec v1.0 Step 4; implementation-binding 2026-05-01.';


-- =============================================================================
-- Verification queries (run manually after applying migration)
-- =============================================================================

-- 1. Confirm external_id column exists and is nullable
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'sl_articles' AND column_name = 'external_id';

-- 2. Confirm unique constraint is present
-- SELECT constraint_name, constraint_type
--   FROM information_schema.table_constraints
--  WHERE table_name = 'sl_articles'
--    AND constraint_name = 'uq_sla_provider_external_id';

-- 3. Confirm partial index was created
-- SELECT indexname, indexdef
--   FROM pg_indexes
--  WHERE tablename = 'sl_articles'
--    AND indexname = 'idx_sla_provider_external_id';

-- 4. Spot-check: same (provider_id, external_id) pair → unique violation
-- INSERT INTO sl_articles (..., external_id) VALUES (..., 'email:<test@example.com>');
-- INSERT INTO sl_articles (..., external_id) VALUES (..., 'email:<test@example.com>');
-- → second INSERT should violate uq_sla_provider_external_id

-- 5. Spot-check: NULL external_id does NOT collide with another NULL
-- INSERT INTO sl_articles (..., external_id) VALUES (..., NULL);
-- INSERT INTO sl_articles (..., external_id) VALUES (..., NULL);
-- → both INSERTs succeed (documented gap — see NULL semantics above)
