// =============================================================================
// Signal Ledger — deterministic error mapper
// Functional Spec v1.0 §4 — error contract table and deterministic mapping rules.
//
// Step 2: functional stub covering all failure paths needed by sl_ingest_article.
// Step 3: hardens with exhaustive constraint-name routing, full pg error code
//         coverage, and integration tests.
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
// Any 23505 on one of these -> DUPLICATE_ARTICLE.
// Any other 23505 -> SCHEMA_VIOLATION.
// Step 3 adds all unique constraint names from sl_articles.
// ---------------------------------------------------------------------------
const DUPLICATE_ARTICLE_CONSTRAINTS = new Set([
  'uq_sla_provider_title_date',
]);

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
 * PostgREST surfaces it in the details field as:
 *   'Key (col)=(val) conflicts with existing key constraint "constraint_name".'
 */
function extractConstraintName(err: SupabaseError): string | undefined {
  if (!err.details) return undefined;
  const match = err.details.match(/constraint "([^"]+)"/);
  return match?.[1];
}

/**
 * Maps a raw Supabase / database / runtime error to a deterministic MappedError.
 *
 * Mapping rules (Functional Spec §4):
 *   23505 + duplicate-article constraint -> DUPLICATE_ARTICLE (never SYSTEM_ERROR)
 *   23505 + other constraint             -> SCHEMA_VIOLATION
 *   23514 (check violation)              -> SCHEMA_VIOLATION
 *   23502, 23503                         -> VALIDATION_ERROR (pre-caught by validation)
 *   40001, 40P01, 55P03, 08xx, 53xx, 57xx -> TRANSIENT_DB_ERROR
 *   everything else                      -> SYSTEM_ERROR
 *
 * Step 3 will add:
 *   - Full constraint-name routing for all sl_articles constraints
 *   - Embedding API HTTP status -> EMBEDDING_FAILURE / RATE_LIMITED mapping
 *   - Integration test coverage for every code path
 */
export function mapErrorToCode(err: unknown): MappedError {
  const pgErr     = (err ?? {}) as SupabaseError;
  const code       = pgErr.code;
  const constraint = extractConstraintName(pgErr);

  // --- Unique violation ---
  if (code === PG_UNIQUE_VIOLATION) {
    if (constraint && DUPLICATE_ARTICLE_CONSTRAINTS.has(constraint)) {
      return {
        error_code:       'DUPLICATE_ARTICLE',
        retryable:        false,
        failure_category: 'duplicate',
      };
    }
    return {
      error_code:       'SCHEMA_VIOLATION',
      retryable:        false,
      failure_category: 'schema-drift',
    };
  }

  // --- Check constraint violation ---
  if (code === PG_CHECK_VIOLATION) {
    return {
      error_code:       'SCHEMA_VIOLATION',
      retryable:        false,
      failure_category: 'schema-drift',
    };
  }

  // --- Not-null / FK violations (should be caught by input validation first) ---
  if (code === PG_NOT_NULL_VIOLATION || code === PG_FK_VIOLATION) {
    return {
      error_code:       'VALIDATION_ERROR',
      retryable:        false,
      failure_category: 'schema-drift',
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
  // SYSTEM_ERROR is the catch-all. DUPLICATE_ARTICLE invariant is preserved
  // because the 23505 branch fires before this fallback.
  console.error('[error_mapper] unclassified error — Step 3 will narrow this', {
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
 * Builds a human-readable error message for the API response.
 * Step 3 will enrich these with constraint-level detail.
 */
export function buildErrorMessage(errorCode: ErrorCode, rawErr: unknown): string {
  const err = (rawErr ?? {}) as SupabaseError;
  switch (errorCode) {
    case 'DUPLICATE_ARTICLE':
      return 'Article already exists for this provider, title, and published date.';
    case 'VALIDATION_ERROR':
      return `Validation failed: ${err.message ?? 'required field missing or invalid type'}`;
    case 'SCHEMA_VIOLATION':
      return `Database constraint violated: ${err.message ?? 'check or unique constraint'}`;
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
