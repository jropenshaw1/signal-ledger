// =============================================================================
// Signal Ledger — deterministic error mapper
// Functional Spec v1.0 §4 — error contract table and deterministic mapping rules.
//
// Step 2: functional stub covering all failure paths needed by sl_ingest_article.
// Step 3: hardened with exhaustive constraint-name routing, full pg error code
//         coverage, embedding API HTTP status mapping, and integration tests.
// Step 4: uq_sla_provider_external_id registered as a DUPLICATE_ARTICLE constraint;
//         buildErrorMessage DUPLICATE_ARTICLE routes by constraintName.
//
// INVARIANT: DUPLICATE_ARTICLE is NEVER mapped to SYSTEM_ERROR (Spec §4).
// INVARIANT: retryable field is required on every error response — no exceptions.
// =============================================================================

import type { ErrorCode, FailureCategory } from './types.ts';

// ---------------------------------------------------------------------------
// PostgreSQL error codes
// Reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
// ---------------------------------------------------------------------------
const PG_UNIQUE_VIOLATION      = '23505'; // unique_violation
const PG_CHECK_VIOLATION       = '23514'; // check_violation
const PG_NOT_NULL_VIOLATION    = '23502'; // not_null_violation
const PG_FK_VIOLATION          = '23503'; // foreign_key_violation
const PG_SERIALIZATION_FAILURE = '40001'; // serialization_failure
const PG_DEADLOCK              = '40P01'; // deadlock_detected
const PG_LOCK_NOT_AVAILABLE    = '55P03'; // lock_not_available

// ---------------------------------------------------------------------------
// Constraint names that identify a duplicate article specifically.
// Any 23505 on one of these -> DUPLICATE_ARTICLE (never SYSTEM_ERROR).
// Any other 23505            -> SCHEMA_VIOLATION.
//
// Add an entry here whenever a new unique constraint on sl_articles should
// be treated as a duplicate-article signal rather than a schema drift.
// The test suite enforces that every entry has a CONSTRAINT_MESSAGES entry.
// ---------------------------------------------------------------------------
const DUPLICATE_ARTICLE_CONSTRAINTS = new Set([
  'uq_sla_provider_title_date',
  'uq_sla_provider_external_id',   // Step 4: (provider_id, external_id) idempotency key
]);

// ---------------------------------------------------------------------------
// Human-readable descriptions for every sl_articles constraint.
// Used by buildErrorMessage to produce actionable SCHEMA_VIOLATION messages,
// and by the DUPLICATE_ARTICLE branch to name the specific duplicate key.
// Add an entry here whenever a new constraint is added to sl_articles.
// ---------------------------------------------------------------------------
const CONSTRAINT_MESSAGES: Record<string, string> = {
  // Unique — duplicate article detection
  uq_sla_provider_title_date:
    'Article already exists for this provider, title, and published date.',
  uq_sla_provider_external_id:
    'Article already exists for this provider and external identifier (Message-ID or content hash).',
  // Check — classification
  ck_sla_content_type:
    'content_type must be "Nate-feature-article" or "Nate-executive-briefing".',
  ck_sla_ingestion_source:
    'ingestion_source must be "web" or "email-backfill".',
  ck_sla_capture_completeness:
    'capture_completeness must be "complete", "preview-only", or "partial".',
  // Check — body text coherence
  ck_sla_body_text_completeness:
    'body_text must be NULL for preview-only rows and non-NULL for complete/partial rows.',
  // Check — embedding provenance
  ck_sla_embedding_provenance:
    'embedding, embedding_model, embedding_version, and content_hash must all be set or all be NULL.',
  ck_sla_content_hash_format:
    'content_hash must be a 64-character lowercase hex SHA-256 string.',
  ck_sla_embedding_version_format:
    'embedding_version must follow the format: provider/model/YYYY-MM-DD/N.',
  // Check — JSONB shape (structured_signposts)
  ck_sla_structured_signposts_is_array:
    'structured_signposts must be a JSONB array.',
  ck_sla_signposts_shape:
    'Each structured_signposts entry must include signpost_id, extraction_method, and extracted_at.',
  // Check — JSONB shape (cited_claims)
  ck_sla_cited_claims_is_array:
    'cited_claims must be a JSONB array.',
  ck_sla_claims_shape:
    'Each cited_claims entry must include claim_id, extraction_method, and extracted_at.',
  // Check — JSONB shape (structured_technical_content)
  ck_sla_structured_technical_content_is_array:
    'structured_technical_content must be a JSONB array.',
  ck_sla_technical_shape:
    'Each structured_technical_content entry must include block_id, extraction_method, and extracted_at.',
  // Check — embedding coherence
  ck_sla_embedding_requires_body:
    'An embedding vector requires body_text to be present.',
  ck_sla_embedding_status:
    'embedding_status must be NULL or one of: "pending", "processing", "complete", "failed".',
  ck_sla_embedding_status_complete:
    'embedding_status must be "complete" when an embedding vector is present.',
  ck_sla_embedding_status_preview_null:
    'embedding_status must be NULL for preview-only articles.',
};

// ---------------------------------------------------------------------------
// Retryability map — Functional Spec §4 and §5.
// Source of truth: every error_code maps to exactly one retryable value.
// ---------------------------------------------------------------------------
export const ERROR_CODE_RETRYABLE: Record<ErrorCode, boolean> = {
  DUPLICATE_ARTICLE:   false,
  VALIDATION_ERROR:    false,
  SCHEMA_VIOLATION:    false,
  EMBEDDING_FAILURE:   true,
  RATE_LIMITED:        true,
  TRANSIENT_DB_ERROR:  true,
  SYSTEM_ERROR:        true,
};

// ---------------------------------------------------------------------------
// Mapped error shape
// ---------------------------------------------------------------------------
export interface MappedError {
  error_code:       ErrorCode;
  retryable:        boolean;
  failure_category: FailureCategory;
  /**
   * PostgreSQL constraint name when the error originates from a named
   * constraint. Passed to buildErrorMessage for constraint-level detail.
   * Undefined for non-constraint errors.
   */
  constraint?:      string;
}

// ---------------------------------------------------------------------------
// Supabase/PostgREST error shape
// ---------------------------------------------------------------------------
interface SupabaseError {
  code?:    string;
  message?: string;
  details?: string;
  hint?:    string;
}

/**
 * Extracts the PostgreSQL constraint name from a Supabase/PostgREST error.
 *
 * Unique violations (23505) — PostgREST surfaces the name in `details`:
 *   'Key (col)=(val) conflicts with existing key constraint "constraint_name".'
 *
 * Check violations (23514) — PostgREST surfaces the name in `message`:
 *   'new row for relation "sl_articles" violates check constraint "constraint_name"'
 *
 * Both formats share the same regex; `details` is checked first so that unique
 * violations (which may set both fields) prefer the `details` value.
 */
function extractConstraintName(err: SupabaseError): string | undefined {
  const pattern = /constraint "([^"]+)"/;
  if (err.details) {
    const m = err.details.match(pattern);
    if (m?.[1]) return m[1];
  }
  if (err.message) {
    const m = err.message.match(pattern);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/**
 * Maps a raw Supabase / database / runtime error to a deterministic MappedError.
 *
 * Mapping rules (Functional Spec §4):
 *   23505 + duplicate-article constraint  -> DUPLICATE_ARTICLE (never SYSTEM_ERROR)
 *   23505 + other constraint              -> SCHEMA_VIOLATION
 *   23514 (check violation)               -> SCHEMA_VIOLATION
 *   23502, 23503                          -> VALIDATION_ERROR
 *   40001, 40P01, 55P03, 08xx, 53xx, 57xx -> TRANSIENT_DB_ERROR
 *   everything else                       -> SYSTEM_ERROR
 */
export function mapErrorToCode(err: unknown): MappedError {
  const pgErr      = (err ?? {}) as SupabaseError;
  const code        = pgErr.code;
  const constraint  = extractConstraintName(pgErr);

  // --- Unique violation ---
  if (code === PG_UNIQUE_VIOLATION) {
    if (constraint && DUPLICATE_ARTICLE_CONSTRAINTS.has(constraint)) {
      return {
        error_code:       'DUPLICATE_ARTICLE',
        retryable:        false,
        failure_category: 'duplicate',
        constraint,
      };
    }
    return {
      error_code:       'SCHEMA_VIOLATION',
      retryable:        false,
      failure_category: 'schema-drift',
      constraint,
    };
  }

  // --- Check constraint violation ---
  if (code === PG_CHECK_VIOLATION) {
    return {
      error_code:       'SCHEMA_VIOLATION',
      retryable:        false,
      failure_category: 'schema-drift',
      constraint,
    };
  }

  // --- Not-null / FK violations (should be pre-caught by input validation) ---
  if (code === PG_NOT_NULL_VIOLATION || code === PG_FK_VIOLATION) {
    return {
      error_code:       'VALIDATION_ERROR',
      retryable:        false,
      failure_category: 'schema-drift',
      constraint,
    };
  }

  // --- Transient DB errors (retry warranted) ---
  if (
    code === PG_SERIALIZATION_FAILURE ||
    code === PG_DEADLOCK              ||
    code === PG_LOCK_NOT_AVAILABLE    ||
    code?.startsWith('08')            || // connection errors
    code?.startsWith('53')            || // insufficient resources
    code?.startsWith('57')               // operator intervention
  ) {
    return {
      error_code:       'TRANSIENT_DB_ERROR',
      retryable:        true,
      failure_category: 'unknown',
    };
  }

  // --- Unclassified fallback ---
  // SYSTEM_ERROR is the catch-all. The DUPLICATE_ARTICLE invariant is preserved
  // because the 23505 branch fires before this fallback.
  console.error('[error_mapper] unclassified error — review for narrowing', {
    code,
    constraint,
    message: pgErr.message,
    details: pgErr.details,
  });

  return {
    error_code:       'SYSTEM_ERROR',
    retryable:        true,
    failure_category: 'unknown',
  };
}

/**
 * Maps an embedding API HTTP response status to a MappedError.
 *
 * Called by the Step 5 embedding worker and any caller that makes a direct
 * embedding API request and receives a non-success HTTP status.
 *
 *   429           -> RATE_LIMITED    (retryable: true  — wait and retry)
 *   5xx           -> EMBEDDING_FAILURE (retryable: true  — server-side transient)
 *   4xx (not 429) -> EMBEDDING_FAILURE (retryable: false — bad request, won't heal)
 *   other         -> EMBEDDING_FAILURE (retryable: true  — unknown, be conservative)
 */
export function mapEmbeddingHttpStatus(httpStatus: number): MappedError {
  if (httpStatus === 429) {
    return {
      error_code:       'RATE_LIMITED',
      retryable:        true,
      failure_category: 'unknown',
    };
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    return {
      error_code:       'EMBEDDING_FAILURE',
      retryable:        true,
      failure_category: 'unknown',
    };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    // 4xx that isn't 429 (bad request, invalid model, auth error, etc.).
    // These won't heal on retry without a code or config fix.
    return {
      error_code:       'EMBEDDING_FAILURE',
      retryable:        false,
      failure_category: 'unknown',
    };
  }
  // 1xx / 2xx non-success / 3xx — unexpected from an embedding API.
  // Treat conservatively: retry may resolve a transient redirect or oddity.
  return {
    error_code:       'EMBEDDING_FAILURE',
    retryable:        true,
    failure_category: 'unknown',
  };
}

/**
 * Builds a human-readable error message for the API response.
 *
 * When `constraintName` is supplied (from MappedError.constraint), the message
 * uses the CONSTRAINT_MESSAGES lookup for actionable constraint-level detail.
 * If the constraint is not in the lookup, a fallback names the constraint so
 * engineers can identify the gap.
 *
 * DUPLICATE_ARTICLE routes by constraintName when present so that both
 * uq_sla_provider_title_date and uq_sla_provider_external_id produce distinct,
 * accurate messages. Falls back to the title_date message when constraintName
 * is absent (pre-Step-4 callers, tests without constraint context).
 */
export function buildErrorMessage(
  errorCode:       ErrorCode,
  rawErr:          unknown,
  constraintName?: string,
): string {
  const err = (rawErr ?? {}) as SupabaseError;

  switch (errorCode) {
    case 'DUPLICATE_ARTICLE': {
      // Route to the specific constraint message when available.
      const msg = constraintName
        ? CONSTRAINT_MESSAGES[constraintName]
        : undefined;
      return msg ?? CONSTRAINT_MESSAGES['uq_sla_provider_title_date'];
    }

    case 'VALIDATION_ERROR':
      return `Validation failed: ${err.message ?? 'required field missing or invalid type'}`;

    case 'SCHEMA_VIOLATION': {
      const detail = constraintName
        ? (CONSTRAINT_MESSAGES[constraintName] ?? `Constraint violated: ${constraintName}.`)
        : (err.message ?? 'check or unique constraint violated');
      return `Schema violation: ${detail}`;
    }

    case 'TRANSIENT_DB_ERROR':
      return 'Transient database error — safe to retry with backoff.';

    case 'EMBEDDING_FAILURE':
      return 'Embedding API failure — retry is warranted.';

    case 'RATE_LIMITED':
      return 'Upstream rate limit hit — retry after backoff.';

    case 'SYSTEM_ERROR':
    default:
      return 'Internal system error. The failure event has been logged.';
  }
}
