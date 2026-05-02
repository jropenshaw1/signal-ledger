// =============================================================================
// Signal Ledger — embedding client tests
// Run: deno test supabase/functions/_shared/embedding_client_test.ts
//
// Step 5: tests for parseEmbeddingApiResponse (pure function, no network).
// generateEmbedding wraps fetch and is tested via integration tests.
// =============================================================================

import {
  assertEquals,
  assertExists,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  parseEmbeddingApiResponse,
  getEmbeddingModel,
  getEmbeddingVersion,
  getEmbeddingDimensions,
  type EmbeddingResponse,
} from './embedding_client.ts';

// ---------------------------------------------------------------------------
// Helper: generate a fake embedding vector of correct dimensions
// ---------------------------------------------------------------------------
function fakeVector(dims = 1536): number[] {
  return Array.from({ length: dims }, (_, i) => i * 0.001);
}

function openAiSuccessBody(embedding?: number[]) {
  return {
    object: 'list',
    data: [
      {
        object:    'embedding',
        index:     0,
        embedding: embedding ?? fakeVector(),
      },
    ],
    model: 'text-embedding-3-small',
    usage: {
      prompt_tokens: 42,
      total_tokens:  42,
    },
  };
}

// =============================================================================
// SECTION 1 — Provenance constant accessors
// =============================================================================

Deno.test('[embedding_client] getEmbeddingModel returns locked model', () => {
  assertEquals(getEmbeddingModel(), 'text-embedding-3-small');
});

Deno.test('[embedding_client] getEmbeddingVersion matches format constraint', () => {
  const version = getEmbeddingVersion();
  // Must match ck_sla_embedding_version_format: ^[^/]+/[^/]+/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]+$
  assertEquals(/^[^/]+\/[^/]+\/\d{4}-\d{2}-\d{2}\/\d+$/.test(version), true);
});

Deno.test('[embedding_client] getEmbeddingDimensions returns 1536', () => {
  assertEquals(getEmbeddingDimensions(), 1536);
});

// =============================================================================
// SECTION 2 — parseEmbeddingApiResponse: success cases
// =============================================================================

Deno.test('[parseEmbeddingApiResponse] 200 + valid body → success', () => {
  const result = parseEmbeddingApiResponse(200, openAiSuccessBody());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.embedding.length, 1536);
    assertEquals(result.model, 'text-embedding-3-small');
    assertEquals(result.usage.prompt_tokens, 42);
    assertEquals(result.usage.total_tokens, 42);
  }
});

Deno.test('[parseEmbeddingApiResponse] 200 + missing usage → defaults to 0', () => {
  const body = {
    data: [{ embedding: fakeVector() }],
    model: 'text-embedding-3-small',
    // no usage field
  };
  const result = parseEmbeddingApiResponse(200, body);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.usage.prompt_tokens, 0);
    assertEquals(result.usage.total_tokens, 0);
  }
});

Deno.test('[parseEmbeddingApiResponse] 200 + missing model → falls back to default', () => {
  const body = {
    data: [{ embedding: fakeVector() }],
    // no model field
  };
  const result = parseEmbeddingApiResponse(200, body);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.model, 'text-embedding-3-small');
  }
});

// =============================================================================
// SECTION 3 — parseEmbeddingApiResponse: failure cases
// =============================================================================

Deno.test('[parseEmbeddingApiResponse] 429 → failure with httpStatus 429', () => {
  const result = parseEmbeddingApiResponse(429, { error: { message: 'rate limited' } });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 429);
  }
});

Deno.test('[parseEmbeddingApiResponse] 500 → failure with httpStatus 500', () => {
  const result = parseEmbeddingApiResponse(500, { error: { message: 'server error' } });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 500);
  }
});

Deno.test('[parseEmbeddingApiResponse] 401 → failure with httpStatus 401', () => {
  const result = parseEmbeddingApiResponse(401, { error: { message: 'invalid api key' } });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 401);
  }
});

Deno.test('[parseEmbeddingApiResponse] 400 → failure with httpStatus 400', () => {
  const result = parseEmbeddingApiResponse(400, { error: { message: 'bad request' } });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 400);
  }
});

Deno.test('[parseEmbeddingApiResponse] non-200 + null body → failure with fallback message', () => {
  const result = parseEmbeddingApiResponse(503, null);
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 503);
    assertEquals(result.message.includes('503'), true);
  }
});

// =============================================================================
// SECTION 4 — parseEmbeddingApiResponse: edge cases (200 with bad data)
// =============================================================================

Deno.test('[parseEmbeddingApiResponse] 200 + null body → failure', () => {
  const result = parseEmbeddingApiResponse(200, null);
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 200);
    assertEquals(result.message.includes('no embedding data'), true);
  }
});

Deno.test('[parseEmbeddingApiResponse] 200 + empty data array → failure', () => {
  const result = parseEmbeddingApiResponse(200, { data: [] });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 200);
  }
});

Deno.test('[parseEmbeddingApiResponse] 200 + data without embedding → failure', () => {
  const result = parseEmbeddingApiResponse(200, { data: [{ index: 0 }] });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 200);
  }
});

Deno.test('[parseEmbeddingApiResponse] 200 + wrong dimension count → failure', () => {
  const result = parseEmbeddingApiResponse(200, {
    data: [{ embedding: [0.1, 0.2, 0.3] }], // 3 dimensions, not 1536
    model: 'text-embedding-3-small',
  });
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.httpStatus, 200);
    assertEquals(result.message.includes('1536'), true);
    assertEquals(result.message.includes('3'), true);
  }
});

Deno.test('[parseEmbeddingApiResponse] 200 + embedding is string, not array → failure', () => {
  const result = parseEmbeddingApiResponse(200, {
    data: [{ embedding: 'not-an-array' }],
  });
  assertEquals(result.success, false);
});

// =============================================================================
// SECTION 5 — integration with mapEmbeddingHttpStatus
// Verify that failure httpStatus values from parseEmbeddingApiResponse
// feed correctly into the existing error mapper.
// =============================================================================

import { mapEmbeddingHttpStatus } from './error_mapper.ts';

Deno.test('[integration] 429 failure → RATE_LIMITED via error mapper', () => {
  const parsed = parseEmbeddingApiResponse(429, { error: { message: 'limit' } });
  assertEquals(parsed.success, false);
  if (!parsed.success) {
    const mapped = mapEmbeddingHttpStatus(parsed.httpStatus);
    assertEquals(mapped.error_code, 'RATE_LIMITED');
    assertEquals(mapped.retryable, true);
  }
});

Deno.test('[integration] 500 failure → EMBEDDING_FAILURE retryable via error mapper', () => {
  const parsed = parseEmbeddingApiResponse(500, null);
  assertEquals(parsed.success, false);
  if (!parsed.success) {
    const mapped = mapEmbeddingHttpStatus(parsed.httpStatus);
    assertEquals(mapped.error_code, 'EMBEDDING_FAILURE');
    assertEquals(mapped.retryable, true);
  }
});

Deno.test('[integration] 401 failure → EMBEDDING_FAILURE non-retryable via error mapper', () => {
  const parsed = parseEmbeddingApiResponse(401, null);
  assertEquals(parsed.success, false);
  if (!parsed.success) {
    const mapped = mapEmbeddingHttpStatus(parsed.httpStatus);
    assertEquals(mapped.error_code, 'EMBEDDING_FAILURE');
    assertEquals(mapped.retryable, false);
  }
});

Deno.test('[integration] network error (httpStatus=0) → EMBEDDING_FAILURE retryable', () => {
  // Network errors from generateEmbedding return httpStatus=0
  const mapped = mapEmbeddingHttpStatus(0);
  assertEquals(mapped.error_code, 'EMBEDDING_FAILURE');
  assertEquals(mapped.retryable, true);
});
