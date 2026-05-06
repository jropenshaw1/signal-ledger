-- =============================================================================
-- Signal Ledger — consolidated schema aligned to Data Dictionary v0.3 (LOCKED 2026-05-05)
--
-- Applies all `public.sl_*` tables: E1 sl_articles, E2 sl_prompt_kits,
-- E3 sl_kit_evaluation_stamps, E4 sl_provider_records, E5 sl_evaluative_sessions,
-- E7 sl_capture_events, E8 sl_signpost_embeddings.
--
-- GREENFIELD OR RESET: drops existing Signal Ledger tables (namespaced `sl_*` only).
-- Safe on OpenBrain co-tenanted Supabase projects — does not touch non-sl tables.
--
-- Deploy: `supabase db push` (linked project) or run this file in the SQL editor.
-- Requires: pgvector (`CREATE EXTENSION vector`).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Legacy cleanup (Signal Ledger isolation boundary)
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS public.sl_signpost_embeddings CASCADE;
DROP TABLE IF EXISTS public.sl_kit_evaluation_stamps CASCADE;
DROP TABLE IF EXISTS public.sl_prompt_kits CASCADE;
DROP TABLE IF EXISTS public.sl_capture_events CASCADE;
DROP TABLE IF EXISTS public.sl_evaluative_sessions CASCADE;
DROP TABLE IF EXISTS public.sl_articles CASCADE;
DROP TABLE IF EXISTS public.sl_provider_records CASCADE;

-- -----------------------------------------------------------------------------
-- JSONB shape helpers (immutable; DD v0.3 § E1a / E1b / E1 author_signposts)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sl_validate_author_signposts(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT j IS NOT NULL
   AND jsonb_typeof(j) = 'array'
   AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(j) AS e
        WHERE jsonb_typeof(e) <> 'string'
    );
$$;

CREATE OR REPLACE FUNCTION sl_validate_cited_claims(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT j IS NOT NULL
   AND jsonb_typeof(j) = 'array'
   AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(j) AS e
        WHERE e->>'claim_text' IS NULL
           OR e->>'claim_type' IS NULL
           OR e->>'claim_type' NOT IN (
                'statistic', 'assertion', 'prediction', 'attribution'
            )
    );
$$;

CREATE OR REPLACE FUNCTION sl_validate_structured_technical_content(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT j IS NOT NULL
   AND jsonb_typeof(j) = 'array'
   AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(j) AS e
        WHERE e->>'block_name' IS NULL
           OR e->>'block_type' IS NULL
           OR e->>'block_content' IS NULL
           OR e->>'kit_candidate' IS NULL
           OR jsonb_typeof(e->'kit_candidate') <> 'boolean'
           OR e->>'block_type' NOT IN (
                'framework', 'model', 'methodology', 'taxonomy', 'heuristic'
            )
    );
$$;

CREATE OR REPLACE FUNCTION sl_validate_gap_windows(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT j IS NOT NULL
   AND jsonb_typeof(j) = 'array'
   AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(j) AS e
        WHERE e->>'start_date' IS NULL
           OR e->>'end_date' IS NULL
           OR e->>'provider_id' IS NULL
           OR e->>'status' IS NULL
           OR e->>'last_updated' IS NULL
           OR e->>'status' NOT IN (
                'open', 'acknowledged', 'resolved', 'unresolvable'
            )
    );
$$;

-- =============================================================================
-- E4 — PROVIDER RECORD
-- =============================================================================

CREATE TABLE public.sl_provider_records (
    provider_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    provider_name text NOT NULL,
    platform text NOT NULL,
    publication_name text,
    publication_url text,
    subscription_tier text NOT NULL,
    corpus_start_date date NOT NULL,
    article_count integer NOT NULL DEFAULT 0 CHECK (article_count >= 0),
    last_ingestion_date date,
    gap_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT ck_spr_platform CHECK (platform IN ('Substack')),
    CONSTRAINT ck_spr_subscription_tier CHECK (subscription_tier IN ('free', 'paid')),
    CONSTRAINT ck_spr_corpus_start_date CHECK (corpus_start_date <= CURRENT_DATE),
    CONSTRAINT ck_spr_gap_windows_is_array CHECK (jsonb_typeof(gap_windows) = 'array'),
    CONSTRAINT ck_spr_gap_windows_shape CHECK (sl_validate_gap_windows(gap_windows))
);

CREATE INDEX idx_spr_provider_name ON public.sl_provider_records (provider_name);
CREATE INDEX idx_spr_platform ON public.sl_provider_records (platform);

COMMENT ON TABLE public.sl_provider_records IS
'Signal Ledger E4 — provider record per Data Dictionary v0.3.';
COMMENT ON COLUMN public.sl_provider_records.gap_windows IS
'JSONB array of gap window objects (E6): start_date, end_date, provider_id, '
'status, article_count_estimated, resolution_path, resolution_notes, '
'last_updated, per DD v0.3.';

-- =============================================================================
-- E1 — ARTICLE
-- =============================================================================

CREATE TABLE public.sl_articles (
    article_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    provider_id uuid NOT NULL REFERENCES public.sl_provider_records (provider_id) ON DELETE RESTRICT,
    external_id text NOT NULL,
    content_type text NOT NULL,
    title text NOT NULL,
    published_date date NOT NULL,
    ingestion_date timestamptz NOT NULL DEFAULT now(),
    ingestion_source text NOT NULL,
    capture_completeness text NOT NULL,
    embedding_status text NOT NULL DEFAULT 'pending',
    url text,
    body_text text,
    author_signposts jsonb NOT NULL DEFAULT '[]'::jsonb,
    cited_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
    structured_technical_content jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT uq_sla_provider_external_id UNIQUE (provider_id, external_id),
    CONSTRAINT ck_sla_content_type CHECK (content_type IN ('Nate-feature-article', 'Nate-executive-briefing')),
    CONSTRAINT ck_sla_ingestion_source CHECK (
        ingestion_source IN ('web', 'email-backfill')
    ),
    CONSTRAINT ck_sla_capture_completeness CHECK (
        capture_completeness IN ('complete', 'preview-only', 'partial')
    ),
    CONSTRAINT ck_sla_embedding_status CHECK (
        embedding_status IN ('pending', 'processing', 'complete', 'failed')
    ),
    CONSTRAINT ck_sla_body_text_completeness CHECK (
        (
            capture_completeness = 'preview-only'
            AND body_text IS NULL
        )
        OR (
            capture_completeness IN ('complete', 'partial')
            AND body_text IS NOT NULL
        )
    ),
    CONSTRAINT ck_sla_author_signposts_is_array CHECK (jsonb_typeof(author_signposts) = 'array'),
    CONSTRAINT ck_sla_author_signposts_shape CHECK (sl_validate_author_signposts(author_signposts)),
    CONSTRAINT ck_sla_cited_claims_is_array CHECK (jsonb_typeof(cited_claims) = 'array'),
    CONSTRAINT ck_sla_cited_claims_shape CHECK (sl_validate_cited_claims(cited_claims)),
    CONSTRAINT ck_sla_structured_technical_content_is_array CHECK (
        jsonb_typeof(structured_technical_content) = 'array'
    ),
    CONSTRAINT ck_sla_structured_technical_content_shape CHECK (
        sl_validate_structured_technical_content(structured_technical_content)
    )
);

CREATE INDEX idx_sla_embedding_status ON public.sl_articles (embedding_status);
CREATE INDEX idx_sla_published_date ON public.sl_articles (published_date);
CREATE INDEX idx_sla_provider_content_type ON public.sl_articles (provider_id, content_type);
CREATE INDEX idx_sla_capture_completeness ON public.sl_articles (capture_completeness);
CREATE INDEX idx_sla_provider_id ON public.sl_articles (provider_id);

COMMENT ON TABLE public.sl_articles IS 'Signal Ledger E1 — article per Data Dictionary v0.3.';
COMMENT ON COLUMN public.sl_articles.embedding_status IS
'Embedding pipeline lifecycle (FS §2). Distinct from E8 vector row.';
COMMENT ON COLUMN public.sl_articles.author_signposts IS
'JSONB array of strings — explicit rhetorical signpost phrases per DD v0.3.';
COMMENT ON COLUMN public.sl_articles.external_id IS
'Source-stable id; with provider_id forms idempotency key (FS §5).';

-- =============================================================================
-- E2 — PROMPT KIT
-- =============================================================================

CREATE TABLE public.sl_prompt_kits (
    kit_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    article_id uuid NOT NULL REFERENCES public.sl_articles (article_id) ON DELETE CASCADE,
    kit_name text NOT NULL,
    kit_content text NOT NULL,
    created_date timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spk_article_id ON public.sl_prompt_kits (article_id);

COMMENT ON TABLE public.sl_prompt_kits IS 'Signal Ledger E2 — prompt kit per DD v0.3.';

-- =============================================================================
-- E3 — KIT EVALUATION STAMP (append-only; DD field set only)
-- =============================================================================

CREATE TABLE public.sl_kit_evaluation_stamps (
    stamp_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    kit_id uuid NOT NULL REFERENCES public.sl_prompt_kits (kit_id) ON DELETE CASCADE,
    stamp_date date NOT NULL,
    execution_context text NOT NULL,
    repeat_disposition text NOT NULL,
    notes text,
    CONSTRAINT ck_skes_repeat_disposition CHECK (
        repeat_disposition IN (
            'repeat-scheduled',
            'conditionally-deferred',
            'one-time'
        )
    ),
    CONSTRAINT ck_skes_stamp_date_not_future CHECK (stamp_date <= CURRENT_DATE)
);

CREATE INDEX idx_skes_kit_stamp_date ON public.sl_kit_evaluation_stamps (kit_id, stamp_date);

COMMENT ON TABLE public.sl_kit_evaluation_stamps IS
'Signal Ledger E3 — kit evaluation stamps per DD v0.3 (accumulating append-only).';

-- =============================================================================
-- E5 — EVALUATIVE SESSION (append-only; DD field set only)
-- =============================================================================

CREATE TABLE public.sl_evaluative_sessions (
    session_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    provider_id uuid NOT NULL REFERENCES public.sl_provider_records (provider_id) ON DELETE RESTRICT,
    session_date date NOT NULL,
    tier_disposition text NOT NULL,
    evidence_summary text NOT NULL,
    notes text,
    CONSTRAINT ck_ses_tier_disposition CHECK (
        tier_disposition IN (
            'maintain-current-tier',
            'upgrade-candidate',
            'degradation-signal',
            'abandon-signal'
        )
    ),
    CONSTRAINT ck_ses_evidence_summary_not_empty CHECK (length(trim(evidence_summary)) > 0),
    CONSTRAINT ck_ses_session_date_not_future CHECK (session_date <= CURRENT_DATE)
);

CREATE INDEX idx_ses_provider_session_date ON public.sl_evaluative_sessions (
    provider_id,
    session_date DESC
);

COMMENT ON TABLE public.sl_evaluative_sessions IS
'Signal Ledger E5 — evaluative sessions per DD v0.3 (accumulating append-only).';

-- =============================================================================
-- E7 — CAPTURE EVENT (append-only; DD-aligned columns only)
-- =============================================================================

CREATE TABLE public.sl_capture_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    article_id uuid REFERENCES public.sl_articles (article_id) ON DELETE SET NULL,
    provider_id uuid NOT NULL REFERENCES public.sl_provider_records (provider_id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    error_code text,
    retry_of_event_id uuid REFERENCES public.sl_capture_events (event_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
    metadata jsonb,
    CONSTRAINT ck_sce_event_type CHECK (
        event_type IN (
            'ingestion_started',
            'ingestion_succeeded',
            'ingestion_failed',
            'embedding_queued',
            'embedding_succeeded',
            'embedding_failed',
            'retry_attempted'
        )
    ),
    CONSTRAINT ck_sce_error_code_values CHECK (
        error_code IS NULL
        OR error_code IN (
            'DUPLICATE_ARTICLE',
            'VALIDATION_ERROR',
            'SCHEMA_VIOLATION',
            'EMBEDDING_FAILURE',
            'RATE_LIMITED',
            'TRANSIENT_DB_ERROR',
            'SYSTEM_ERROR'
        )
    ),
    CONSTRAINT ck_sce_retry_not_self CHECK (
        retry_of_event_id IS NULL OR retry_of_event_id <> event_id
    ),
    CONSTRAINT ck_sce_retry_attempt_requires_predecessor CHECK (
        event_type <> 'retry_attempted' OR retry_of_event_id IS NOT NULL
    ),
    CONSTRAINT ck_sce_error_code_null_rule CHECK (
        (
            event_type IN ('ingestion_failed', 'embedding_failed')
            AND error_code IS NOT NULL
        )
        OR (
            event_type NOT IN ('ingestion_failed', 'embedding_failed')
            AND error_code IS NULL
        )
    )
);

CREATE INDEX idx_sce_article_created ON public.sl_capture_events (
    article_id,
    created_at
);
CREATE INDEX idx_sce_event_type_created ON public.sl_capture_events (event_type, created_at);
CREATE INDEX idx_sce_retry_of_event_id ON public.sl_capture_events (retry_of_event_id);
CREATE INDEX idx_sce_provider_created ON public.sl_capture_events (
    provider_id,
    created_at DESC
);

COMMENT ON TABLE public.sl_capture_events IS
'Signal Ledger E7 — immutable capture event log per DD v0.3.';

-- =============================================================================
-- E8 — SIGNPOST EMBEDDING (one row per article_id + model_id; FS §2, DD § E8)
-- =============================================================================

CREATE TABLE public.sl_signpost_embeddings (
    embedding_id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    article_id uuid NOT NULL REFERENCES public.sl_articles (article_id) ON DELETE CASCADE,
    model_id text NOT NULL,
    embedding extensions.vector (1536) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_sse_article_model UNIQUE (article_id, model_id)
);

CREATE INDEX idx_sse_embedding_hnsw ON public.sl_signpost_embeddings
USING hnsw (embedding extensions.vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE public.sl_signpost_embeddings IS
'Signal Ledger E8 — semantic embedding storage per DD v0.3; unique per (article_id, model_id).';
COMMENT ON COLUMN public.sl_signpost_embeddings.provenance IS
'Required JSON object (FS §2); evolves with embedding API payloads.';
