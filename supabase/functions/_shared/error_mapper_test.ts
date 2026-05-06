// =============================================================================
// Signal Ledger — error_mapper tests (DD v0.3 sl_articles constraint names)
// Run: deno test supabase/functions/_shared/error_mapper_test.ts
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
} from './error_mapper.ts';
import type { ErrorCode } from './types.ts';

function pgUnique(constraintName: string) {
  return {
    code:    '23505',
    message: `duplicate key value violates unique constraint "${constraintName}"`,
    details: `Key (col)=(val) conflicts with existing key constraint "${constraintName}".`,
    hint:    null,
  };
}

function pgCheck(constraintName: string) {
  return {
    code:    '23514',
    message: `new row for relation "sl_articles" violates check constraint "${constraintName}"`,
    details: null,
    hint:    null,
  };
}

function pgNotNull(columnName: string) {
  return {
    code:    '23502',
    message: `null value in column "${columnName}" of relation "sl_articles" violates not-null constraint`,
    details: `Failing row contains (null, ...).`,
    hint:    null,
  };
}

function pgFk(constraintName: string) {
  return {
    code:    '23503',
    message: `insert or update on table "sl_articles" violates foreign key constraint "${constraintName}"`,
    details: `Key missing in parent.`,
    hint:    null,
  };
}

function pgCode(code: string) {
  return { code, message: 'database error', details: null, hint: null };
}

Deno.test('[mapErrorToCode] 23505 + uq_sla_provider_external_id → DUPLICATE_ARTICLE', () => {
  const result = mapErrorToCode(pgUnique('uq_sla_provider_external_id'));
  assertEquals(result.error_code,       'DUPLICATE_ARTICLE');
  assertEquals(result.retryable,        false);
  assertEquals(result.failure_category, 'duplicate');
  assertEquals(result.constraint,       'uq_sla_provider_external_id');
});

Deno.test('[mapErrorToCode] 23505 + unknown unique → SCHEMA_VIOLATION', () => {
  const result = mapErrorToCode(pgUnique('uq_future'));
  assertEquals(result.error_code, 'SCHEMA_VIOLATION');
  assertEquals(result.retryable,  false);
});

const checkConstraints: string[] = [
  'ck_sla_content_type',
  'ck_sla_ingestion_source',
  'ck_sla_capture_completeness',
  'ck_sla_body_text_completeness',
  'ck_sla_author_signposts_is_array',
  'ck_sla_author_signposts_shape',
  'ck_sla_cited_claims_is_array',
  'ck_sla_cited_claims_shape',
  'ck_sla_structured_technical_content_is_array',
  'ck_sla_structured_technical_content_shape',
  'ck_sla_embedding_status',
];

for (const constraintName of checkConstraints) {
  Deno.test(`[mapErrorToCode] 23514 + ${constraintName} → SCHEMA_VIOLATION`, () => {
    const result = mapErrorToCode(pgCheck(constraintName));
    assertEquals(result.error_code, 'SCHEMA_VIOLATION');
    assertEquals(result.constraint,  constraintName);
  });
}

Deno.test('[mapErrorToCode] 23502 → VALIDATION_ERROR', () => {
  const result = mapErrorToCode(pgNotNull('title'));
  assertEquals(result.error_code, 'VALIDATION_ERROR');
});

Deno.test('[mapErrorToCode] 23503 → VALIDATION_ERROR', () => {
  const result = mapErrorToCode(pgFk('sl_articles_provider_id_fkey'));
  assertEquals(result.error_code, 'VALIDATION_ERROR');
});

Deno.test('[mapErrorToCode] 40001 → TRANSIENT_DB_ERROR', () => {
  const result = mapErrorToCode(pgCode('40001'));
  assertEquals(result.error_code, 'TRANSIENT_DB_ERROR');
  assertEquals(result.retryable,  true);
});

Deno.test('[mapErrorToCode] unknown PG code → SYSTEM_ERROR', () => {
  const result = mapErrorToCode(pgCode('99999'));
  assertEquals(result.error_code, 'SYSTEM_ERROR');
});

Deno.test('[mapEmbeddingHttpStatus] 429 → RATE_LIMITED', () => {
  const r = mapEmbeddingHttpStatus(429);
  assertEquals(r.error_code, 'RATE_LIMITED');
  assertEquals(r.retryable,  true);
});

Deno.test('[buildErrorMessage] DUPLICATE_ARTICLE defaults to external_id copy', () => {
  const msg = buildErrorMessage('DUPLICATE_ARTICLE', {});
  assertEquals(msg.includes('external identifier'), true);
});

Deno.test('[buildErrorMessage] DUPLICATE_ARTICLE + uq_sla_provider_external_id', () => {
  const msg = buildErrorMessage(
    'DUPLICATE_ARTICLE',
    pgUnique('uq_sla_provider_external_id'),
    'uq_sla_provider_external_id',
  );
  assertEquals(msg.includes('external identifier'), true);
});

Deno.test('[ERROR_CODE_RETRYABLE] all ErrorCodes present', () => {
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
    assertEquals(typeof ERROR_CODE_RETRYABLE[code], 'boolean');
  }
});

Deno.test('[INVARIANT] DUPLICATE_ARTICLE never SYSTEM_ERROR', () => {
  const r = mapErrorToCode(pgUnique('uq_sla_provider_external_id'));
  assertNotEquals(r.error_code, 'SYSTEM_ERROR');
});

for (const constraintName of checkConstraints) {
  Deno.test(`[buildErrorMessage] SCHEMA_VIOLATION + ${constraintName}`, () => {
    const msg = buildErrorMessage('SCHEMA_VIOLATION', {}, constraintName);
    assertExists(msg);
    assertEquals(msg.includes('Constraint violated:'), false);
  });
}
