// =============================================================================
// Signal Ledger — deterministic error mapper
// Functional Spec v1.1 §4 — error contract table and deterministic mapping rules.
//
// INVARIANT: DUPLICATE_ARTICLE is NEVER mapped to SYSTEM_ERROR (Spec §4).
// INVARIANT: retryable is required on every API error response.
//
// Aligned to Data Dictionary v0.3 sl_articles / sl_capture_events constraints.
// =============================================================================

import type { ErrorCode, FailureCategory } from './types.ts';

const PG_UNIQUE_VIOLATION      = '23505';
const PG_CHECK_VIOLATION       = '23514';
const PG_NOT_NULL_VIOLATION    = '23502';
const PG_FK_VIOLATION          = '23503';
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK              = '40P01';
const PG_LOCK_NOT_AVAILABLE    = '55P03';

const DUPLICATE_ARTICLE_CONSTRAINTS = new Set(['uq_sla_provider_external_id']);

const CONSTRAINT_MESSAGES: Record<string, string> = {
  uq_sla_provider_external_id:
    'Article already exists for this provider and external identifier (Message-ID, content hash, or preview key).',
  ck_sla_content_type:
    'content_type must be "Nate-feature-article" or "Nate-executive-briefing".',
  ck_sla_ingestion_source:
    'ingestion_source must be "web" or "email-backfill".',
  ck_sla_capture_completeness:
    'capture_completeness must be "complete", "preview-only", or "partial".',
  ck_sla_body_text_completeness:
    'body_text must be NULL for preview-only rows and non-NULL for complete/partial rows.',
  ck_sla_author_signposts_is_array:
    'author_signposts must be a JSONB array.',
  ck_sla_author_signposts_shape:
    'Each author_signposts entry must be a JSON string.',
  ck_sla_cited_claims_is_array:
    'cited_claims must be a JSONB array.',
  ck_sla_cited_claims_shape:
    'Each cited_claims entry must include claim_text and claim_type.',
  ck_sla_structured_technical_content_is_array:
    'structured_technical_content must be a JSONB array.',
  ck_sla_structured_technical_content_shape:
    'Each structured_technical_content entry must include block_name, block_type, block_content, and kit_candidate.',
  ck_sla_embedding_status:
    'embedding_status must be one of: pending, processing, complete, failed.',
};

export const ERROR_CODE_RETRYABLE: Record<ErrorCode, boolean> = {
  DUPLICATE_ARTICLE:   false,
  VALIDATION_ERROR:    false,
  SCHEMA_VIOLATION:    false,
  EMBEDDING_FAILURE:   true,
  RATE_LIMITED:        true,
  TRANSIENT_DB_ERROR:  true,
  SYSTEM_ERROR:        true,
};

export interface MappedError {
  error_code:       ErrorCode;
  retryable:        boolean;
  failure_category: FailureCategory;
  constraint?:      string;
}

interface SupabaseError {
  code?:    string;
  message?: string;
  details?: string;
  hint?:    string;
}

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

export function mapErrorToCode(err: unknown): MappedError {
  const pgErr      = (err ?? {}) as SupabaseError;
  const code        = pgErr.code;
  const constraint  = extractConstraintName(pgErr);

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

  if (code === PG_CHECK_VIOLATION) {
    return {
      error_code:       'SCHEMA_VIOLATION',
      retryable:        false,
      failure_category: 'schema-drift',
      constraint,
    };
  }

  if (code === PG_NOT_NULL_VIOLATION || code === PG_FK_VIOLATION) {
    return {
      error_code:       'VALIDATION_ERROR',
      retryable:        false,
      failure_category: 'schema-drift',
      constraint,
    };
  }

  if (
    code === PG_SERIALIZATION_FAILURE ||
    code === PG_DEADLOCK              ||
    code === PG_LOCK_NOT_AVAILABLE    ||
    code?.startsWith('08')            ||
    code?.startsWith('53')            ||
    code?.startsWith('57')
  ) {
    return {
      error_code:       'TRANSIENT_DB_ERROR',
      retryable:        true,
      failure_category: 'unknown',
    };
  }

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
    return {
      error_code:       'EMBEDDING_FAILURE',
      retryable:        false,
      failure_category: 'unknown',
    };
  }
  return {
    error_code:       'EMBEDDING_FAILURE',
    retryable:        true,
    failure_category: 'unknown',
  };
}

export function buildErrorMessage(
  errorCode:       ErrorCode,
  rawErr:          unknown,
  constraintName?: string,
): string {
  const err = (rawErr ?? {}) as SupabaseError;

  switch (errorCode) {
    case 'DUPLICATE_ARTICLE': {
      const msg = constraintName
        ? CONSTRAINT_MESSAGES[constraintName]
        : undefined;
      return msg ?? CONSTRAINT_MESSAGES['uq_sla_provider_external_id'];
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
