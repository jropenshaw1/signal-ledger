-- =============================================================================
-- Signal Ledger: sl_kit_evaluation_stamps
-- Accumulating evaluation record. One row per evaluation event.
-- Never updated or deleted. Each A1 review appends a new row.
-- Scheduling fields added per Decision 4 (AM-07).
-- Dependencies: sl_prompt_kits
-- =============================================================================

CREATE TABLE IF NOT EXISTS sl_kit_evaluation_stamps (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    stamp_id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    kit_id                  uuid        NOT NULL
                                        REFERENCES sl_prompt_kits (kit_id)
                                        ON DELETE CASCADE,

    -- ------------------------------------------------------------------
    -- Evaluation record
    -- ------------------------------------------------------------------

    -- Date A1 performed the evaluation. Declared by A1, written by A2.
    stamp_date              date        NOT NULL,

    -- Session or situation in which the kit was executed.
    -- Kit must have been executed — stamps are not written for unexecuted kits.
    -- Unevaluated is the structural absence of any stamp record, not a value.
    execution_context       text        NOT NULL,

    -- A1's declared forward disposition.
    repeat_disposition      text        NOT NULL,

    -- Optional A1 commentary on execution outcome.
    notes                   text,

    -- ------------------------------------------------------------------
    -- Scheduling fields (Decision 4 — AM-07)
    -- Make Kit Status retrieval operational: "what's due and when",
    -- "which conditions are unreviewed."
    -- ------------------------------------------------------------------

    -- Required when repeat_disposition = 'repeat-scheduled' unless trigger-based.
    next_run_date           date,

    -- Required when repeat_disposition = 'conditionally-deferred'.
    trigger_condition       text,

    -- Optional: a date to revisit a deferred kit regardless of condition status.
    -- Prevents deferred kits from going dark indefinitely.
    review_after_date       date,

    -- ------------------------------------------------------------------
    -- Timestamp
    -- No updated_at — this table is append-only. Rows are never modified.
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),

    -- ------------------------------------------------------------------
    -- Constraints
    -- ------------------------------------------------------------------
    CONSTRAINT ck_skes_repeat_disposition
        CHECK (repeat_disposition IN (
            'repeat-scheduled',
            'conditionally-deferred',
            'one-time'
        )),

    -- next_run_date or trigger_condition required for forward-looking dispositions.
    CONSTRAINT ck_skes_repeat_scheduled_has_schedule
        CHECK (
            repeat_disposition != 'repeat-scheduled'
            OR (next_run_date IS NOT NULL OR trigger_condition IS NOT NULL)
        ),

    CONSTRAINT ck_skes_conditionally_deferred_has_condition
        CHECK (
            repeat_disposition != 'conditionally-deferred'
            OR trigger_condition IS NOT NULL
        ),

    -- Stamp date must not be in the future.
    CONSTRAINT ck_skes_stamp_date_not_future
        CHECK (stamp_date <= CURRENT_DATE)

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Kit evaluation history ordered by date (data dictionary index plan).
CREATE INDEX IF NOT EXISTS idx_skes_kit_stamp_date
    ON sl_kit_evaluation_stamps (kit_id, stamp_date DESC);

-- Kit Status retrieval: scheduled kits due for re-run.
CREATE INDEX IF NOT EXISTS idx_skes_next_run_date
    ON sl_kit_evaluation_stamps (next_run_date)
    WHERE next_run_date IS NOT NULL;

-- Kit Status retrieval: deferred kits by review date.
CREATE INDEX IF NOT EXISTS idx_skes_review_after_date
    ON sl_kit_evaluation_stamps (review_after_date)
    WHERE review_after_date IS NOT NULL;

-- Disposition filter for Kit Status retrieval mode.
CREATE INDEX IF NOT EXISTS idx_skes_repeat_disposition
    ON sl_kit_evaluation_stamps (repeat_disposition);

-- =============================================================================
-- RLS placeholder
-- =============================================================================
-- ALTER TABLE sl_kit_evaluation_stamps ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_kit_evaluation_stamps IS
    'Accumulating evaluation record. Append-only — rows are never updated or deleted. '
    'One row per A1 evaluation event. Unevaluated state is the structural absence '
    'of any stamp record — there is no unevaluated enum value. '
    'Scheduling fields (next_run_date, trigger_condition, review_after_date) '
    'make Kit Status retrieval operational per Decision 4 (AM-07).';

COMMENT ON COLUMN sl_kit_evaluation_stamps.trigger_condition IS
    'Free-text condition that must be met before the kit is re-run. '
    'Required when repeat_disposition = conditionally-deferred. '
    'Example: "After completing AegisRelay Phase 2."';

COMMENT ON COLUMN sl_kit_evaluation_stamps.review_after_date IS
    'Optional safety net for deferred kits. Surfaces the kit for review '
    'on this date regardless of whether trigger_condition has been met. '
    'Prevents conditionally-deferred kits from going dark indefinitely.';
