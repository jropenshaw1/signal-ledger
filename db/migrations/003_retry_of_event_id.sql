-- =============================================================================
-- Migration 003: retry_of_event_id — formal retry chain lineage
-- Signal Ledger — Functional Spec v1.0 §5, Implementation Step 6
--
-- Adds a nullable FK column to sl_capture_events linking each event to the
-- prior event it retries. Enables recursive CTE chain traceability for
-- diagnostics without imposing write-path guards beyond self-reference.
--
-- Decisions locked (Step 6 design review, Gee-reviewed 2026-05-01):
--   - Stage-agnostic: any event_type may carry retry_of_event_id
--   - REFERENCES sl_capture_events(event_id) ON DELETE RESTRICT
--   - CHECK: cannot reference itself (no self-loops)
--   - Write-time app-layer guard: retry_attempted requires non-null retry_of_event_id
--   - No event-type predecessor restrictions at DB level
--   - No backfill of existing event_notes retry references
-- =============================================================================

-- 1. Add the column
ALTER TABLE sl_capture_events
    ADD COLUMN IF NOT EXISTS retry_of_event_id uuid;

-- 2. FK to self — ON DELETE RESTRICT preserves chain integrity
ALTER TABLE sl_capture_events
    ADD CONSTRAINT fk_sce_retry_of_event
    FOREIGN KEY (retry_of_event_id)
    REFERENCES sl_capture_events (event_id)
    ON DELETE RESTRICT;

-- 3. Self-reference guard — an event cannot retry itself
ALTER TABLE sl_capture_events
    ADD CONSTRAINT ck_sce_retry_not_self
    CHECK (retry_of_event_id IS NULL OR retry_of_event_id <> event_id);

-- 4. Index for chain traversal (WHERE non-null is the useful subset)
CREATE INDEX IF NOT EXISTS idx_sce_retry_of_event
    ON sl_capture_events (retry_of_event_id)
    WHERE retry_of_event_id IS NOT NULL;

-- 5. Documentation
COMMENT ON COLUMN sl_capture_events.retry_of_event_id IS
    'FK to the prior capture event this event retries. Stage-agnostic lineage '
    'edge — any event_type may carry it. Self-reference is prohibited by '
    'ck_sce_retry_not_self. Full chain traceability via recursive CTE on '
    '(event_id, retry_of_event_id). Step 6, Functional Spec §5.';
