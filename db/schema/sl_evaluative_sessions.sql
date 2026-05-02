-- =============================================================================
-- Signal Ledger: sl_evaluative_sessions
-- Accumulating provider evaluation record. One row per evaluation event.
-- Never updated or deleted. Each A1 review appends a new row.
-- evidence_refs JSONB added per Decision 3 (AM-06) — optional, additive.
-- Dependencies: sl_provider_records
-- =============================================================================

CREATE TABLE IF NOT EXISTS sl_evaluative_sessions (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    session_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    provider_id             uuid        NOT NULL
                                        REFERENCES sl_provider_records (provider_id)
                                        ON DELETE RESTRICT,

    -- ------------------------------------------------------------------
    -- Evaluation record
    -- ------------------------------------------------------------------

    -- Date A1 conducted the session. Declared by A1, written by A2.
    session_date            date        NOT NULL,

    -- A1's tier conclusion for this session.
    tier_disposition        text        NOT NULL,

    -- A1's stated basis for the disposition.
    -- Required — disposition without stated evidence is not a valid record.
    evidence_summary        text        NOT NULL,

    -- ------------------------------------------------------------------
    -- Evidence refs (Decision 3 — AM-06)
    -- Optional JSONB array. Sessions can be written with prose only;
    -- refs are additive and can be backfilled as the corpus matures.
    --
    -- Object shape:
    -- {
    --   "ref_type":       "article" | "claim" | "structured_block" | "prompt_kit" | "capture_event",
    --   "ref_id":         "uuid or sub-entry id",
    --   "article_id":     "uuid | null",
    --   "published_date": "YYYY-MM-DD | null",
    --   "reason":         "short explanation of why this evidence mattered"
    -- }
    -- ------------------------------------------------------------------
    evidence_refs           jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- Optional extended commentary.
    notes                   text,

    -- ------------------------------------------------------------------
    -- Timestamp
    -- No updated_at — this table is append-only. Rows are never modified.
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),

    -- ------------------------------------------------------------------
    -- Constraints
    -- ------------------------------------------------------------------
    CONSTRAINT ck_ses_tier_disposition
        CHECK (tier_disposition IN (
            'maintain-current-tier',
            'upgrade-candidate',
            'degradation-signal',
            'abandon-signal'
        )),

    -- evidence_summary must not be blank.
    CONSTRAINT ck_ses_evidence_summary_not_empty
        CHECK (length(trim(evidence_summary)) > 0),

    CONSTRAINT ck_ses_evidence_refs_is_array
        CHECK (jsonb_typeof(evidence_refs) = 'array'),

    -- Session date must not be in the future.
    CONSTRAINT ck_ses_session_date_not_future
        CHECK (session_date <= CURRENT_DATE)

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Provider evaluation history ordered by date (data dictionary index plan).
CREATE INDEX IF NOT EXISTS idx_ses_provider_session_date
    ON sl_evaluative_sessions (provider_id, session_date DESC);

-- Disposition filter for evaluative retrieval.
CREATE INDEX IF NOT EXISTS idx_ses_tier_disposition
    ON sl_evaluative_sessions (tier_disposition);

-- =============================================================================
-- RLS placeholder
-- =============================================================================
-- ALTER TABLE sl_evaluative_sessions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_evaluative_sessions IS
    'Accumulating provider evaluation record. Append-only — rows are never '
    'updated or deleted. One row per A1 evaluation event. '
    'evidence_refs is an optional JSONB array (Decision 3, AM-06) — sessions '
    'may be written with evidence_summary prose only and refs backfilled later. '
    'evidence_summary is required; disposition without stated evidence is invalid.';

COMMENT ON COLUMN sl_evaluative_sessions.evidence_refs IS
    'Optional JSONB array of structured evidence references (Decision 3, AM-06). '
    'Each object carries ref_type, ref_id, article_id, published_date, and reason. '
    'Additive — can be backfilled after the session is written. '
    'Enables evaluative retrieval to return both the disposition conclusion '
    'and the specific corpus artifacts that supported it.';

COMMENT ON COLUMN sl_evaluative_sessions.evidence_summary IS
    'Required free-text basis for the tier disposition. '
    'A disposition without stated evidence is not a valid record. '
    'For structured evidence binding, use evidence_refs alongside this field.';
