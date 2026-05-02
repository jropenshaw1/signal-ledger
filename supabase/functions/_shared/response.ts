// =============================================================================
// Signal Ledger — standard response envelope helpers
// Functional Spec v1.0 §4 — error response shapes and success envelope.
// Every response carries { success, data, error } — no naked payloads.
// =============================================================================

import type { ErrorShape, ApiResponse } from './types.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function successResponse<T>(data: T): Response {
  const body: ApiResponse<T> = { success: true, data, error: null };
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: JSON_HEADERS,
  });
}

export function errorResponse(error: ErrorShape, httpStatus = 422): Response {
  const body: ApiResponse<never> = { success: false, data: null, error };
  return new Response(JSON.stringify(body), {
    status:  httpStatus,
    headers: JSON_HEADERS,
  });
}

/**
 * Maps ErrorCode to a semantically correct HTTP status.
 *
 * DUPLICATE_ARTICLE  -> 409 Conflict
 * VALIDATION_ERROR   -> 422 Unprocessable Entity
 * SCHEMA_VIOLATION   -> 422 Unprocessable Entity
 * RATE_LIMITED       -> 429 Too Many Requests
 * EMBEDDING_FAILURE  -> 502 Bad Gateway (upstream API failure)
 * TRANSIENT_DB_ERROR -> 503 Service Unavailable (retry warranted)
 * SYSTEM_ERROR       -> 500 Internal Server Error
 */
export function httpStatusForErrorCode(errorCode: string): number {
  switch (errorCode) {
    case 'DUPLICATE_ARTICLE':   return 409;
    case 'VALIDATION_ERROR':    return 422;
    case 'SCHEMA_VIOLATION':    return 422;
    case 'RATE_LIMITED':        return 429;
    case 'EMBEDDING_FAILURE':   return 502;
    case 'TRANSIENT_DB_ERROR':  return 503;
    case 'SYSTEM_ERROR':
    default:                    return 500;
  }
}
