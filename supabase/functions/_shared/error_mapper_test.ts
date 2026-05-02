// =============================================================================
// Signal Ledger — error_mapper integration tests
// Functional Spec v1.0 Appendix E step 9: failure-path tests first.
//
// Run: deno test supabase/functions/_shared/error_mapper_test.ts
//
// Test order mirrors Appendix E step 9 — failure paths exhausted before
// happy-path coverage and invariant assertions.
//
// Coverage targets:
//   mapErrorToCode    — every PG error code branch + all sl_articles constraints
//   mapEmbeddingHttpStatus — all HTTP status buckets (429, 5xx, 4xx, other)
//   buildErrorMessage — all ErrorCode variants + constraint-level enrichment
//   ERROR_CODE_RETRYABLE — completeness check (no missing ErrorCode)
//   INVARIANTS        — DUPLICATE_ARTICLE never → SYSTEM_ERROR; always retryable=false
//
// Step 4 additions:
//   - uq_sla_provider_external_id → DUPLICATE_ARTICLE (Section 1.1)
//   - buildErrorMessage routes DUPLICATE_ARTICLE by constraintName (Section 3)
//   - DUPLICATE_ARTICLE_CONSTRAINTS completeness loop (Section 6)
//   - NULL × 2 gap documented (Section 6)
// =============================================================================

import {
  assertEquals,
  assertNotEquals,
  assertExists,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  mapErrorToCode,
  mapEmbeddingHttpStatus,
  buildErrorMessage,
  ERROR_CODE_RETRYABLE,
  type MappedError,
} from './error_mapper.ts';
import type { ErrorCode } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers — PostgREST error shape factories
// ---------------------------------------------------------------------------

/** PostgREST unique violation. Constraint name surfaces in `details`. */
function pgUnique(constraintName: string) {
  return {
    code:    '23505',
    message: `duplicate key value violates unique constraint "${constraintName}"`,
    details: `Key (col)=(val) conflicts with existing key constraint "${constraintName}".`,
    hint:    null,
  };
}

/** PostgREST check constraint violation. Constraint name surfaces in `message`. */
function pgCheck(constraintName: string) {
  return {
    code:    '23514',
    message: `new row for relation "sl_articles" violates check constraint "${constraintName}"`,
    details: null,
    hint:    null,
  };
}

/** PostgREST not-null violation. */
function pgNotNull(columnName: string) {
  return {
    code:    '23502',
    message: `null value in column "${columnName}" of relation "sl_articles" violates not-null constraint`,
    details: `Failing row contains (null, ...).`,
    hint:    null,
  };
}

/** PostgREST FK violation. */
function pgFk(constraintName: string) {
  return {
    code:    '23503',
    message: `insert or update on table "sl_articles" violates foreign key constraint "${constraintName}"`,
    details: `Key (provider_id)=(00000000-0000-0000-0000-000000000000) is not present in table "sl_provider_records".`,
    hint:    null,
  };
}

/** Bare PG error with a given code and no constraint detail. */
function pgCode(code: string) {
  return { code, message: 'database error', details: null, hint: null };
}

// =============================================================================
// SECTION 1 — mapErrorToCode: FAILURE PATHS (Appendix E step 9: failures first)
// =============================================================================

// ---------------------------------------------------------------------------
// 1.1  Unique violations (23505)
// ---------------------------------------------------------------------------

Deno.test('[mapErrorToCode] 23505 + uq_sla_provider_title_date → DUPLICATE_ARTICLE', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_provider_title_date'));
  assertEquals(result.error_code,       'DUPLICATE_ARTICLE');
  assertEquals(result.retryable,        false);
  assertEquals(result.failure_category, 'duplicate');
  assertEquals(result.constraint,       'uq_sla_provider_title_date');
});

// Step 4: external_id idempotency key — same provider + same Message-ID → DUPLICATE_ARTICLE
Deno.test('[mapErrorToCode] 23505 + uq_sla_provider_external_id → DUPLICATE_ARTICLE', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_provider_external_id'));
  assertEquals(result.error_code,       'DUPLICATE_ARTICLE');
  assertEquals(result.retryable,        false);
  assertEquals(result.failure_category, 'duplicate');
  assertEquals(result.constraint,       'uq_sla_provider_external_id');
});

Deno.test('[mapErrorToCode] 23505 + unknown unique constraint → SCHEMA_VIOLATION', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_some_future_constraint'));
  assertEquals(result.error_code,       'SCHEMA_VIOLATION');
  assertEquals(result.retryable,        false);
  assertEquals(result.failure_category, 'schema-drift');
  assertEquals(result.constraint,       'uq_sla_some_future_constraint');
});

// ---------------------------------------------------------------------------
// 1.2  Check violations (23514) — all sl_articles constraints
// ---------------------------------------------------------------------------

const checkConstraints: string[] = [
  'ck_sla_content_type',
  'ck_sla_ingestion_source',
  'ck_sla_capture_completeness',
  'ck_sla_body_text_completeness',
  'ck_sla_embedding_provenance',
  'ck_sla_content_hash_format',
  'ck_sla_embedding_version_format',
  'ck_sla_structured_signposts_is_array',
  'ck_sla_signposts_shape',
  'ck_sla_cited_claims_is_array',
  'ck_sla_claims_shape',
  'ck_sla_structured_technical_content_is_array',
  'ck_sla_technical_shape',
  'ck_sla_embedding_requires_body',
  'ck_sla_embedding_status',
  'ck_sla_embedding_status_complete',
  'ck_sla_embedding_status_preview_null',
];

for (const constraintName of checkConstraints) {
  Deno.test(`[mapErrorToCode] 23514 + ${constraintName} → SCHEMA_VIOLATION`, () => {
    const result = mapErrorToCode(pgCheck(constraintName));
    assertEquals(result.error_code,       'SCHEMA_VIOLATION',  `error_code mismatch for ${constraintName}`);
    assertEquals(result.retryable,        false,               `retryable mismatch for ${constraintName}`);
    assertEquals(result.failure_category, 'schema-drift',      `failure_category mismatch for ${constraintName}`);
    assertEquals(result.constraint,       constraintName,      `constraint mismatch for ${constraintName}`);
  });
}

Deno.test('[mapErrorToCode] 23514 + no extractable constraint name → SCHEMA_VIOLATION', () => {
  // Edge case: PostgREST returns a check violation without a recognisable
  // constraint name pattern (e.g. a future message format change).
  const err = { code: '23514', message: 'check constraint violation', details: null };
  const result = mapErrorToCode(err);
  assertEquals(result.error_code,       'SCHEMA_VIOLATION');
  assertEquals(result.retryable,        false);
  assertEquals(result.failure_category, 'schema-drift');
  assertEquals(result.constraint,       undefined);
});

// ---------------------------------------------------------------------------
// 1.3  Not-null and FK violations (23502, 23503)
// These are pre-caught by input validation. Reaching the DB layer is a bug,
// but the mapper must still handle them correctly rather than SYSTEM_ERROR.
// ---------------------------------------------------------------------------

Deno.test('[mapErrorToCode] 23502 not-null violation → VALIDATION_ERROR', () => {
  const result = mapErrorToCode(pgNotNull('provider_id'));
  assertEquals(result.error_code, 'VALIDATION_ERROR');
  assertEquals(result.retryable,  false);
});

Deno.test('[mapErrorToCode] 23503 FK violation → VALIDATION_ERROR', () => {
  const result = mapErrorToCode(pgFk('sl_articles_provider_id_fkey'));
  assertEquals(result.error_code, 'VALIDATION_ERROR');
  assertEquals(result.retryable,  false);
});

// ---------------------------------------------------------------------------
// 1.4  Transient DB errors (all covered PG code prefixes)
// ---------------------------------------------------------------------------

Deno.test('[mapErrorToCode] 40001 serialization failure → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('40001'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] 40P01 deadlock detected → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('40P01'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] 55P03 lock not available → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('55P03'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] 08006 connection failure (08xx prefix) → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('08006'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] 08000 connection exception (08xx prefix) → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('08000'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] 53300 too many connections (53xx prefix) → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('53300'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] 57014 query cancelled (57xx prefix) → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('57014'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

// ---------------------------------------------------------------------------
// 1.5  Unclassified / fallback → SYSTEM_ERROR
// ---------------------------------------------------------------------------

Deno.test('[mapErrorToCode] unknown PG code → SYSTEM_ERROR', () => {
  const result = mapErrorToCode(pgCode('99999'));
  assertEquals(result.error_code, 'SYSTEM_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] null input → SYSTEM_ERROR', () => {
  const result = mapErrorToCode(null);
  assertEquals(result.error_code, 'SYSTEM_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] undefined input → SYSTEM_ERROR', () => {
  const result = mapErrorToCode(undefined);
  assertEquals(result.error_code, 'SYSTEM_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] empty object (no code field) → SYSTEM_ERROR', () => {
  const result = mapErrorToCode({});
  assertEquals(result.error_code, 'SYSTEM_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] non-object input (string) → SYSTEM_ERROR', () => {
  const result = mapErrorToCode('something went wrong');
  assertEquals(result.error_code, 'SYSTEM_ERROR');
  assertEquals(result.retryable,  true);
});

// =============================================================================
// SECTION 2 — mapEmbeddingHttpStatus: all HTTP status buckets
// =============================================================================

Deno.test('[mapEmbeddingHttpStatus] 429 → RATE_LIMITED, retryable=true', () => {
  const result = mapEmbeddingHttpStatus(429);
  assertEquals(result.error_code, 'RATE_LIMITED');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapEmbeddingHttpStatus] 500 → EMBEDDING_FAILURE, retryable=true', () => {
  const result = mapEmbeddingHttpStatus(500);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapEmbeddingHttpStatus] 503 → EMBEDDING_FAILURE, retryable=true', () => {
  const result = mapEmbeddingHttpStatus(503);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapEmbeddingHttpStatus] 599 → EMBEDDING_FAILURE, retryable=true', () => {
  const result = mapEmbeddingHttpStatus(599);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapEmbeddingHttpStatus] 400 bad request → EMBEDDING_FAILURE, retryable=false', () => {
  const result = mapEmbeddingHttpStatus(400);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  false);
});

Deno.test('[mapEmbeddingHttpStatus] 401 unauthorized → EMBEDDING_FAILURE, retryable=false', () => {
  const result = mapEmbeddingHttpStatus(401);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  false);
});

Deno.test('[mapEmbeddingHttpStatus] 413 payload too large → EMBEDDING_FAILURE, retryable=false', () => {
  const result = mapEmbeddingHttpStatus(413);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  false);
});

Deno.test('[mapEmbeddingHttpStatus] 422 unprocessable → EMBEDDING_FAILURE, retryable=false', () => {
  const result = mapEmbeddingHttpStatus(422);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  false);
});

Deno.test('[mapEmbeddingHttpStatus] unexpected status (200) → EMBEDDING_FAILURE, retryable=true', () => {
  // A 200 that somehow reaches the error path is treated conservatively.
  const result = mapEmbeddingHttpStatus(200);
  assertEquals(result.error_code, 'EMBEDDING_FAILURE');
  assertEquals(result.retryable,  true);
});

// =============================================================================
// SECTION 3 — buildErrorMessage: all ErrorCode variants + constraint enrichment
// =============================================================================

Deno.test('[buildErrorMessage] DUPLICATE_ARTICLE (no constraintName) → title_date fallback message', () => {
  // Pre-Step-4 callers and code paths that don't supply constraintName
  // must still get a useful message.
  const msg = buildErrorMessage('DUPLICATE_ARTICLE', {});
  assertEquals(
    msg,
    'Article already exists for this provider, title, and published date.',
  );
});

Deno.test('[buildErrorMessage] DUPLICATE_ARTICLE + uq_sla_provider_title_date → title_date message', () => {
  const msg = buildErrorMessage(
    'DUPLICATE_ARTICLE',
    pgUnique('uq_sla_provider_title_date'),
    'uq_sla_provider_title_date',
  );
  assertEquals(
    msg,
    'Article already exists for this provider, title, and published date.',
  );
});

// Step 4: external_id constraint produces its own distinct message
Deno.test('[buildErrorMessage] DUPLICATE_ARTICLE + uq_sla_provider_external_id → external_id message', () => {
  const msg = buildErrorMessage(
    'DUPLICATE_ARTICLE',
    pgUnique('uq_sla_provider_external_id'),
    'uq_sla_provider_external_id',
  );
  assertEquals(
    msg,
    'Article already exists for this provider and external identifier (Message-ID or content hash).',
  );
});

Deno.test('[buildErrorMessage] VALIDATION_ERROR → includes raw error message', () => {
  const msg = buildErrorMessage(
    'VALIDATION_ERROR',
    { message: 'provider_id is null' },
  );
  assertEquals(msg, 'Validation failed: provider_id is null');
});

Deno.test('[buildErrorMessage] VALIDATION_ERROR + no message → generic fallback', () => {
  const msg = buildErrorMessage('VALIDATION_ERROR', {});
  assertEquals(msg, 'Validation failed: required field missing or invalid type');
});

Deno.test('[buildErrorMessage] SCHEMA_VIOLATION + known constraintName → constraint message', () => {
  const msg = buildErrorMessage(
    'SCHEMA_VIOLATION',
    pgCheck('ck_sla_body_text_completeness'),
    'ck_sla_body_text_completeness',
  );
  assertEquals(
    msg,
    'Schema violation: body_text must be NULL for preview-only rows and non-NULL for complete/partial rows.',
  );
});

Deno.test('[buildErrorMessage] SCHEMA_VIOLATION + unknown constraintName → names the constraint', () => {
  const msg = buildErrorMessage(
    'SCHEMA_VIOLATION',
    pgCheck('ck_sla_future_constraint'),
    'ck_sla_future_constraint',
  );
  assertEquals(msg, 'Schema violation: Constraint violated: ck_sla_future_constraint.');
});

Deno.test('[buildErrorMessage] SCHEMA_VIOLATION + no constraintName → uses raw message', () => {
  const msg = buildErrorMessage(
    'SCHEMA_VIOLATION',
    { message: 'check constraint violated' },
  );
  assertEquals(msg, 'Schema violation: check constraint violated');
});

Deno.test('[buildErrorMessage] SCHEMA_VIOLATION + no constraintName + no message → generic fallback', () => {
  const msg = buildErrorMessage('SCHEMA_VIOLATION', {});
  assertEquals(msg, 'Schema violation: check or unique constraint violated');
});

Deno.test('[buildErrorMessage] TRANSIENT_DB_ERROR → retry guidance', () => {
  const msg = buildErrorMessage('TRANSIENT_DB_ERROR', {});
  assertEquals(msg, 'Transient database error — safe to retry with backoff.');
});

Deno.test('[buildErrorMessage] EMBEDDING_FAILURE → retry guidance', () => {
  const msg = buildErrorMessage('EMBEDDING_FAILURE', {});
  assertEquals(msg, 'Embedding API failure — retry is warranted.');
});

Deno.test('[buildErrorMessage] RATE_LIMITED → backoff guidance', () => {
  const msg = buildErrorMessage('RATE_LIMITED', {});
  assertEquals(msg, 'Upstream rate limit hit — retry after backoff.');
});

Deno.test('[buildErrorMessage] SYSTEM_ERROR → logged message', () => {
  const msg = buildErrorMessage('SYSTEM_ERROR', {});
  assertEquals(msg, 'Internal system error. The failure event has been logged.');
});

// buildErrorMessage for all check constraint names in the lookup table.
// Ensures CONSTRAINT_MESSAGES has a non-empty string for every check constraint.
for (const constraintName of checkConstraints) {
  Deno.test(`[buildErrorMessage] SCHEMA_VIOLATION + ${constraintName} → non-empty constraint message`, () => {
    const msg = buildErrorMessage('SCHEMA_VIOLATION', {}, constraintName);
    assertExists(msg);
    assertNotEquals(msg, '');
    // Must not fall through to the generic "Constraint violated:" fallback,
    // which would signal a gap in CONSTRAINT_MESSAGES.
    assertEquals(
      msg.includes('Constraint violated:'),
      false,
      `${constraintName} missing from CONSTRAINT_MESSAGES — add an entry`,
    );
  });
}

// =============================================================================
// SECTION 4 — ERROR_CODE_RETRYABLE completeness
// Every ErrorCode variant must appear in the map.
// =============================================================================

Deno.test('[ERROR_CODE_RETRYABLE] covers all ErrorCode variants', () => {
  const allCodes: ErrorCode[] = [
    'DUPLICATE_ARTICLE',
    'VALIDATION_ERROR',
    'SCHEMA_VIOLATION',
    'EMBEDDING_FAILURE',
    'RATE_LIMITED',
    'TRANSIENT_DB_ERROR',
    'SYSTEM_ERROR',
  ];

  for (const code of allCodes) {
    const retryable = ERROR_CODE_RETRYABLE[code];
    assertEquals(
      typeof retryable,
      'boolean',
      `ERROR_CODE_RETRYABLE missing entry for ${code}`,
    );
  }
});

// =============================================================================
// SECTION 5 — INVARIANTS
// =============================================================================

Deno.test('[INVARIANT] DUPLICATE_ARTICLE is never mapped to SYSTEM_ERROR', () => {
  const dupResult = mapErrorToCode(pgUnique('uq_sla_provider_title_date'));
  assertNotEquals(dupResult.error_code, 'SYSTEM_ERROR');
  assertEquals(dupResult.error_code,    'DUPLICATE_ARTICLE');
});

Deno.test('[INVARIANT] uq_sla_provider_external_id never mapped to SYSTEM_ERROR', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_provider_external_id'));
  assertNotEquals(result.error_code, 'SYSTEM_ERROR');
  assertEquals(result.error_code,    'DUPLICATE_ARTICLE');
});

Deno.test('[INVARIANT] DUPLICATE_ARTICLE always retryable=false', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_provider_title_date'));
  assertEquals(result.error_code, 'DUPLICATE_ARTICLE');
  assertEquals(result.retryable,  false);
  assertEquals(ERROR_CODE_RETRYABLE['DUPLICATE_ARTICLE'], false);
});

Deno.test('[INVARIANT] uq_sla_provider_external_id duplicate always retryable=false', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_provider_external_id'));
  assertEquals(result.error_code, 'DUPLICATE_ARTICLE');
  assertEquals(result.retryable,  false);
});

Deno.test('[INVARIANT] SCHEMA_VIOLATION always retryable=false', () => {
  const result = mapErrorToCode(pgCheck('ck_sla_content_type'));
  assertEquals(result.error_code, 'SCHEMA_VIOLATION');
  assertEquals(result.retryable,  false);
  assertEquals(ERROR_CODE_RETRYABLE['SCHEMA_VIOLATION'], false);
});

Deno.test('[INVARIANT] VALIDATION_ERROR always retryable=false', () => {
  const result = mapErrorToCode(pgNotNull('title'));
  assertEquals(result.error_code, 'VALIDATION_ERROR');
  assertEquals(result.retryable,  false);
  assertEquals(ERROR_CODE_RETRYABLE['VALIDATION_ERROR'], false);
});

Deno.test('[INVARIANT] TRANSIENT_DB_ERROR always retryable=true', () => {
  const result = mapErrorToCode(pgCode('40001'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
  assertEquals(ERROR_CODE_RETRYABLE['TRANSIENT_DB_ERROR'], true);
});

Deno.test('[INVARIANT] RATE_LIMITED always retryable=true', () => {
  const result = mapEmbeddingHttpStatus(429);
  assertEquals(result.error_code, 'RATE_LIMITED');
  assertEquals(result.retryable,  true);
  assertEquals(ERROR_CODE_RETRYABLE['RATE_LIMITED'], true);
});

Deno.test('[INVARIANT] all MappedError results carry a boolean retryable field', () => {
  const cases = [
    pgUnique('uq_sla_provider_title_date'),
    pgUnique('uq_sla_provider_external_id'),
    pgCheck('ck_sla_content_type'),
    pgNotNull('title'),
    pgFk('sl_articles_provider_id_fkey'),
    pgCode('40001'),
    pgCode('08006'),
    pgCode('99999'),
    null,
    undefined,
    {},
  ];

  for (const input of cases) {
    const result = mapErrorToCode(input);
    assertEquals(
      typeof result.retryable,
      'boolean',
      `retryable must be boolean for input: ${JSON.stringify(input)}`,
    );
    assertExists(result.error_code);
    assertExists(result.failure_category);
  }
});

// =============================================================================
// SECTION 6 — DUPLICATE_ARTICLE_CONSTRAINTS completeness
// Every entry in DUPLICATE_ARTICLE_CONSTRAINTS must have a CONSTRAINT_MESSAGES
// entry. This loop enforces that invariant at the test level — adding a new
// unique constraint to DUPLICATE_ARTICLE_CONSTRAINTS without a message will
// cause the corresponding buildErrorMessage test to fail.
// =============================================================================

// All unique constraints that should map to DUPLICATE_ARTICLE.
// Keep in sync with DUPLICATE_ARTICLE_CONSTRAINTS in error_mapper.ts.
const duplicateArticleConstraints: string[] = [
  'uq_sla_provider_title_date',
  'uq_sla_provider_external_id',
];

for (const constraintName of duplicateArticleConstraints) {
  Deno.test(`[DUPLICATE_ARTICLE_CONSTRAINTS completeness] ${constraintName} → DUPLICATE_ARTICLE + non-empty message`, () => {
    // 1. Constraint maps correctly
    const mapped = mapErrorToCode(pgUnique(constraintName));
    assertEquals(
      mapped.error_code,
      'DUPLICATE_ARTICLE',
      `${constraintName} should map to DUPLICATE_ARTICLE`,
    );

    // 2. buildErrorMessage produces a non-empty, non-fallback message
    const msg = buildErrorMessage('DUPLICATE_ARTICLE', pgUnique(constraintName), constraintName);
    assertExists(msg);
    assertNotEquals(msg, '');
    assertEquals(
      msg.includes('Constraint violated:'),
      false,
      `${constraintName} missing from CONSTRAINT_MESSAGES — add an entry`,
    );
  });
}

// ---------------------------------------------------------------------------
// NULL × 2 gap — documented behaviour, not a mapper test.
//
// When two rows for the same provider_id have external_id = NULL, the DB
// unique constraint uq_sla_provider_external_id does NOT fire (Postgres
// treats NULL as distinct from every value, including other NULLs).
// The mapper therefore never sees a 23505 for this case — both INSERTs
// succeed at the DB level.
//
// This gap is intentional and documented:
//   - NULL external_id is rare/transitional (preview-only + no Message-ID).
//   - The app-layer duplicate guard for (provider_id, title, published_date)
//     still provides a secondary check for these records.
//   - Engineers adding email-backfill records should always supply message_id
//     when available, or body_text sufficient to derive an email_hash.
//
// There is no mapper test for this case because the mapper is never invoked —
// the constraint simply does not fire. The gap is acceptance-tested at the
// integration layer (Step 4 integration test suite, not yet written).
// ---------------------------------------------------------------------------
