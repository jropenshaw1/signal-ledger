-- =============================================================================
-- Fix sl_articles content_type constraint (ADR-015 unified vocabulary)
--
-- Schema v0.3 created ck_sla_content_type (Nate-* values). Migration
-- retrieval_tools_ws1 adds chk_content_type only when content_type column
-- is missing — on existing installs the old CHECK remained. Swap constraints
-- in three steps so rows can migrate to ('article', 'prompt_kit').
-- =============================================================================

-- 1. Remove legacy Nate-specific CHECK
ALTER TABLE public.sl_articles DROP CONSTRAINT IF EXISTS ck_sla_content_type;

-- 2. Normalize in-database values to the unified enum
UPDATE public.sl_articles
SET content_type = 'article'
WHERE content_type IN (
    'Nate-feature-article',
    'Nate-executive-briefing',
    'Nate-executive-briefing-preview'
);

-- 3. Enforce unified CHECK (skip if already applied, e.g. re-run safe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE c.conname = 'chk_content_type'
            AND t.relname = 'sl_articles'
            AND n.nspname = 'public'
    ) THEN
        ALTER TABLE public.sl_articles
            ADD CONSTRAINT chk_content_type
            CHECK (
                content_type IN ('article', 'prompt_kit')
            );
    END IF;
END
$$;
