-- =============================================================================
-- Signal Ledger: sl_capture_events
-- Immutable audit trail. One row per capture attempt, retry, enrichment,
-- or supersession. Never updated or deleted. Append-only.
-- Satisfies Charter P11 (failure data as infrastructure) and AM-05.
-- Dependencies: sl_provider_records, sl_articles
-- =============================================================================

CREATE TABLE IF NOT EXISTS sl_capture_events (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    event_id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Always known — every event belongs to a provider.
    provider_id             uuid        NOT NULL
                                        REFERENCES sl_provider_records (provider_id)
                                        ON DELETE RESTRICT,

    -- Null when capture failed before an article row was created.
    -- This is the key capability over article-version rows: failure
    -- events can exist without a corresponding article.
    article_id              uuid
                                        REFERENCES sl_articles (article_id)
                                        ON DELETE SET NULL,

    -- ------------------------------------------------------------------
    -- Event classification
    -- ------------------------------------------------------------------

    -- What kind of pipeline action created this event.
    event_type              text        NOT NULL,

    -- Outcome of the action.
    event_status            text        NOT NULL,

    -- How the content entered (or was attempted to enter) the system.
    ingestion_source        text        NOT NULL,

    -- ------------------------------------------------------------------
    -- Capture attempt details
    -- Populated with whatever was known at attempt time.
    -- Null fields reflect information not yet available, not system failure.
    -- ------------------------------------------------------------------
    attempted_url           text,
    attempted_title         text,
    attempted_published_date date,

    -- ------------------------------------------------------------------
    -- Source vs. system honesty (Charter P9)
    -- Distinguishes what the source did not provide from what the system
    -- failed to capture. This is the audit layer's primary diagnostic field.
    -- ------------------------------------------------------------------
    source_vs_system_classification text NOT NULL,

    -- Populated when event_status = 'failed' or 'partial'.
    failure_category        text,

    -- ------------------------------------------------------------------
    -- Retry state
    -- ------------------------------------------------------------------
    retry_count             integer     NOT NULL DEFAULT 0,

    -- Raw diagnostic detail from the pipeline at time of event.
    raw_error               text,

    -- Human/agent-readable context for audit and investigation.
    event_notes             text,

    -- ------------------------------------------------------------------
    -- Timestamp
    -- No updated_at — this table is append-only. Rows are never modified.
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),

    -- ------------------------------------------------------------------
    -- Constraints
    -- ------------------------------------------------------------------
    -- event_type: 7 pipeline-stage types defined in Functional Spec §3.
    -- Classifies the pipeline action that produced this event (stage, not method).
    -- Capture method is carried by ingestion_source on the same row.
    -- Updated from pre-spec taxonomy in migration 001 (2026-05-01).
    CONSTRAINT ck_sce_event_type
        CHECK (event_type IN (
            'ingestion_started',
            'ingestion_succeeded',
            'ingestion_failed',
            'embedding_queued',
            'embedding_succeeded',
            'embedding_failed',
            'retry_attempted'
        )),

    CONSTRAINT ck_sce_event_status
        CHECK (event_status IN (
            'success',
            'failed',
            'partial',
            'preview-only',
            'duplicate-detected',
            'resolved',
            'unresolvable'
        )),

    CONSTRAINT ck_sce_ingestion_source
        CHECK (ingestion_source IN (
            'web',
            'email-backfill',
            'manual',
            'mcp-api'
        )),

    CONSTRAINT ck_sce_source_vs_system
        CHECK (source_vs_system_classification IN (
            'source-not-provided',
            'system-failed',
            'unknown',
            'not-applicable'
        )),

    CONSTRAINT ck_sce_failure_category
        CHECK (failure_category IS NULL OR failure_category IN (
            'paywall',
            'rendering-failure',
            'network-error',
            'parse-error',
            'missing-email',
            'schema-drift',
            'duplicate',
            'unknown'
        )),

    CONSTRAINT ck_sce_retry_count_non_negative
        CHECK (retry_count >= 0),

    -- failure_category binding by status.
    -- success, resolved      → must be NULL (clean outcomes carry no failure category).
    -- failed, partial,
    -- unresolvable           → must be NOT NULL (failure must be classified).
    -- preview-only,
    -- duplicate-detected     → either value permitted (informational category allowed).
    -- Ruling 2026-05-01, decision 4.
    CONSTRAINT ck_sce_failure_category_required
        CHECK (
            (event_status IN ('success', 'resolved')
                AND failure_category IS NULL)
            OR (event_status IN ('failed', 'partial', 'unresolvable')
                AND failure_category IS NOT NULL)
            OR event_status IN ('preview-only', 'duplicate-detected')
        )

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Provider-scoped audit queries ordered by time.
CREATE INDEX IF NOT EXISTS idx_sce_provider_created
    ON sl_capture_events (provider_id, created_at DESC);

-- Article event history lookup.
CREATE INDEX IF NOT EXISTS idx_sce_article_id
    ON sl_capture_events (article_id)
    WHERE article_id IS NOT NULL;

-- Failure and retry investigation.
CREATE INDEX IF NOT EXISTS idx_sce_event_status
    ON sl_capture_events (event_status);

-- Source vs. system classification for audit retrieval.
CREATE INDEX IF NOT EXISTS idx_sce_source_vs_system
    ON sl_capture_events (source_vs_system_classification);

-- =============================================================================
-- RLS placeholder
-- =============================================================================
-- ALTER TABLE sl_capture_events ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_capture_events IS
    'Immutable audit trail. Append-only — rows are never updated or deleted. '
    'One row per capture attempt, retry, enrichment, or supersession event. '
    'article_id is nullable: failure events that occur before an article row '
    'is created are recorded here with article_id = null. '
    'Satisfies Charter P11 (failure data as infrastructure) and AM-05.';

COMMENT ON COLUMN sl_capture_events.source_vs_system_classification IS
    'Charter P9 honesty field. Distinguishes content the source did not provide '
    '(source-not-provided) from content the system failed to capture (system-failed). '
    'This is the primary diagnostic field for audit retrieval.';

COMMENT ON COLUMN sl_capture_events.article_id IS
    'Null when capture failed before an article row was created. '
    'ON DELETE SET NULL preserves the event record if the article is later deleted.';
