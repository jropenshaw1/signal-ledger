// =============================================================================
// Signal Ledger — OpenAI embedding client
// Functional Spec v1.0 §2 — embedding pipeline sequencing.
//
// Step 5: typed wrapper around the OpenAI embeddings API.
// Pure response-parsing logic is exported separately for unit testing.
//
// Model lock (v1): text-embedding-3-small, 1536 dimensions.
// No model-version routing in v1.
// =============================================================================

// ---------------------------------------------------------------------------
// Constants — locked for v1 (Functional Spec §2, Model Lock)
// ---------------------------------------------------------------------------
const EMBEDDING_MODEL       = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS  = 1536;
const EMBEDDING_VERSION     = 'openai/text-embedding-3-small/2024-01-25/001';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface EmbeddingSuccess {
  success:    true;
  embedding:  number[];
  model:      string;
  usage:      { prompt_tokens: number; total_tokens: number };
}

export interface EmbeddingFailure {
  success:    false;
  httpStatus: number;
  message:    string;
}

export type EmbeddingResponse = EmbeddingSuccess | EmbeddingFailure;

// ---------------------------------------------------------------------------
// Provenance accessors (used by the embedding worker for DB writes)
// ---------------------------------------------------------------------------

export function getEmbeddingModel(): string      { return EMBEDDING_MODEL; }
export function getEmbeddingVersion(): string    { return EMBEDDING_VERSION; }
export function getEmbeddingDimensions(): number { return EMBEDDING_DIMENSIONS; }

// ---------------------------------------------------------------------------
// Response parser — pure function, unit-testable without network
// ---------------------------------------------------------------------------

/**
 * Parses the HTTP response from the OpenAI embeddings API into a typed result.
 *
 * Exported for unit testing. The `generateEmbedding` function calls this
 * internally after receiving the fetch response.
 *
 * @param httpStatus - HTTP status code from the response
 * @param body       - Parsed JSON body (or null if body parsing failed)
 */
export function parseEmbeddingApiResponse(
  httpStatus: number,
  body:       unknown,
): EmbeddingResponse {
  // Non-success HTTP status
  if (httpStatus < 200 || httpStatus >= 300) {
    const errorMsg = typeof body === 'object' && body !== null
      ? JSON.stringify(body)
      : String(body ?? 'no response body');
    return {
      success:    false,
      httpStatus,
      message:    `OpenAI API error ${httpStatus}: ${errorMsg}`,
    };
  }

  // Success status but validate response shape
  const data = body as Record<string, unknown> | null;
  const dataArray = data?.data as Array<{ embedding?: number[] }> | undefined;
  const embeddingData = dataArray?.[0]?.embedding;

  if (!embeddingData || !Array.isArray(embeddingData)) {
    return {
      success:    false,
      httpStatus: 200,
      message:    'OpenAI API returned 200 but no embedding data in response',
    };
  }

  if (embeddingData.length !== EMBEDDING_DIMENSIONS) {
    return {
      success:    false,
      httpStatus: 200,
      message:    `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embeddingData.length}`,
    };
  }

  const usage = data?.usage as { prompt_tokens?: number; total_tokens?: number } | undefined;

  return {
    success:   true,
    embedding: embeddingData,
    model:     (data?.model as string) ?? EMBEDDING_MODEL,
    usage: {
      prompt_tokens: usage?.prompt_tokens ?? 0,
      total_tokens:  usage?.total_tokens  ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// API caller — wraps fetch, not unit-testable without network mocking
// ---------------------------------------------------------------------------

/**
 * Calls the OpenAI embeddings API to generate a vector for the given text.
 *
 * Returns a typed EmbeddingResponse — callers never handle raw HTTP.
 * Network errors (DNS, timeout, etc.) return httpStatus = 0, which
 * mapEmbeddingHttpStatus treats as retryable (conservative fallback).
 */
export async function generateEmbedding(
  text:   string,
  apiKey: string,
): Promise<EmbeddingResponse> {
  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:      EMBEDDING_MODEL,
        input:      text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Body parse failure — treat as the HTTP status indicates
      body = null;
    }

    return parseEmbeddingApiResponse(response.status, body);
  } catch (err) {
    // Network-level failure (DNS, timeout, connection refused, etc.)
    return {
      success:    false,
      httpStatus: 0,
      message:    `Network error: ${(err as Error).message ?? 'unknown'}`,
    };
  }
}
