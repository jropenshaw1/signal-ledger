-- =============================================================================
-- Signal Ledger: sl_provider_records
-- First-class provider entity. One row per content provider.
-- V1: Nate B. Jones (Substack) only. Multi-provider architecture validated.
-- Dependencies: none — this is the root of the Signal Ledger FK graph.
-- =============================================================================

-- Shared updated_at trigger function for all Signal Ledger tables.
-- CREATE OR REPLACE is idempotent — safe to run multiple times.
CREATE OR REPLACE FUNCTION sl_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS sl_provider_records (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    provider_id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ------------------------------------------------------------------
    -- Provider metadata
    -- ------------------------------------------------------------------
    provider_name           text        NOT NULL,

    -- V1: 'Substack' only. Extend check constraint when new platforms added.
    platform                text        NOT NULL,

    -- Newsletter name when distinct from provider name (e.g. "The Nate Jones Letter")
    publication_name        text,
    publication_url         text,

    -- A1's subscription level at time of last update.
    subscription_tier       text        NOT NULL,

    -- Earliest article date in scope. V1: 2026-02-12 (Jonathan's subscription start).
    corpus_start_date       date        NOT NULL,

    -- ------------------------------------------------------------------
    -- Ingestion state
    -- ------------------------------------------------------------------

    -- Running count of ingested articles. Updated at each ingestion.
    -- Native Postgres UPDATE — no OB round-trip required (OQ-DD-04 closed).
    article_count           integer     NOT NULL DEFAULT 0,

    last_ingestion_date     date,

    -- ------------------------------------------------------------------
    -- Gap windows (JSONB array of E6 objects)
    -- Object shape:
    -- {
    --   "gap_start":               "YYYY-MM-DD",
    --   "gap_end":                 "YYYY-MM-DD",
    --   "article_count_estimated": integer | null,
    --   "resolution_status":       "pending" | "resolved" | "unresolvable",
    --   "resolution_path":         "web" | "email-backfill" | "none" | null
    -- }
    -- V1 known gap: 2026-02-12 through 2026-02-21 (~10 articles).
    --   resolution_path: email-backfill, resolution_status: pending.
    -- ------------------------------------------------------------------
    gap_windows             jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- ------------------------------------------------------------------
    -- Timestamps
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    -- ------------------------------------------------------------------
    -- Constraints
    -- ------------------------------------------------------------------
    CONSTRAINT ck_spr_platform
        CHECK (platform IN ('Substack')),

    CONSTRAINT ck_spr_subscription_tier
        CHECK (subscription_tier IN ('free', 'paid')),

    CONSTRAINT ck_spr_article_count_non_negative
        CHECK (article_count >= 0),

    CONSTRAINT ck_spr_corpus_start_date
        CHECK (corpus_start_date <= CURRENT_DATE),

    CONSTRAINT ck_spr_gap_windows_is_array
        CHECK (jsonb_typeof(gap_windows) = 'array')

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Provider lookup by name (human-readable audit queries).
CREATE INDEX IF NOT EXISTS idx_spr_provider_name
    ON sl_provider_records (provider_name);

-- Provider lookup by platform for multi-provider fan-out queries.
CREATE INDEX IF NOT EXISTS idx_spr_platform
    ON sl_provider_records (platform);

-- =============================================================================
-- updated_at trigger
-- =============================================================================

DROP TRIGGER IF EXISTS trg_spr_updated_at ON sl_provider_records;

CREATE TRIGGER trg_spr_updated_at
    BEFORE UPDATE ON sl_provider_records
    FOR EACH ROW
    EXECUTE FUNCTION sl_set_updated_at();

-- =============================================================================
-- RLS placeholder
-- =============================================================================
-- ALTER TABLE sl_provider_records ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_provider_records IS
    'First-class provider entity. One row per content provider. '
    'V1: Nate B. Jones (Substack) only. Provider-level trajectory — '
    'tier history, ingestion state, and gap windows — is maintained here. '
    'Evaluative sessions (sl_evaluative_sessions) FK to this table.';

COMMENT ON COLUMN sl_provider_records.gap_windows IS
    'JSONB array of gap window objects (E6). Each object carries gap_start, '
    'gap_end, article_count_estimated, resolution_status, and resolution_path. '
    'V1 known gap: 2026-02-12 through 2026-02-21, resolution_path: email-backfill.';

COMMENT ON COLUMN sl_provider_records.article_count IS
    'Running count of ingested articles. Updated by ingestion pipeline '
    'on each successful sl_articles write. No OB round-trip required.';
