-- =============================================================================
-- Signal Ledger: sl_prompt_kits
-- Extracted prompt artifacts bound to their parent article.
-- The only mutable artifacts in Signal Ledger (Charter: Mutable Artifact Carve-Out).
-- Evaluation history lives in sl_kit_evaluation_stamps — never in this table.
-- Dependencies: sl_articles
-- =============================================================================

CREATE TABLE IF NOT EXISTS sl_prompt_kits (

    -- ------------------------------------------------------------------
    -- Identity
    -- ------------------------------------------------------------------
    kit_id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cascade on delete: if the parent article is removed, its kits go with it.
    article_id              uuid        NOT NULL
                                        REFERENCES sl_articles (article_id)
                                        ON DELETE CASCADE,

    -- ------------------------------------------------------------------
    -- Kit content
    -- ------------------------------------------------------------------
    kit_name                text        NOT NULL,

    -- The extractable prompt or template. Mutable — can be refined
    -- as access expands or extraction improves (Charter cultivation pattern).
    kit_content             text        NOT NULL,

    -- ------------------------------------------------------------------
    -- Timestamps
    -- ------------------------------------------------------------------
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()

);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Kit lookup by parent article.
CREATE INDEX IF NOT EXISTS idx_spk_article_id
    ON sl_prompt_kits (article_id);

-- =============================================================================
-- updated_at trigger
-- =============================================================================

DROP TRIGGER IF EXISTS trg_spk_updated_at ON sl_prompt_kits;

CREATE TRIGGER trg_spk_updated_at
    BEFORE UPDATE ON sl_prompt_kits
    FOR EACH ROW
    EXECUTE FUNCTION sl_set_updated_at();

-- =============================================================================
-- RLS placeholder
-- =============================================================================
-- ALTER TABLE sl_prompt_kits ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sl_prompt_kits IS
    'Extracted prompt artifacts bound to their parent article. '
    'The only mutable artifacts in Signal Ledger — kit_content may be '
    'refined as access expands or extraction improves (Charter cultivation pattern). '
    'Evaluation history accumulates in sl_kit_evaluation_stamps. '
    'Empty stamp set = unevaluated (default state; no explicit status field needed).';

COMMENT ON COLUMN sl_prompt_kits.kit_content IS
    'The extractable prompt or template. Mutable — this is the one field '
    'in Signal Ledger that may be updated post-ingestion as cultivation '
    'improves the extraction. Changes are logged via sl_capture_events '
    'with event_type = enrichment.';
