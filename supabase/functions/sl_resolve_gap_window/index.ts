// =============================================================================
// Signal Ledger — sl_resolve_gap_window Edge Function
// MCP tool: sl_resolve_gap_window (docs/sl_mcp_tool_signatures_v1.md)
// Functional Spec v1.1 §7 — gap JSON optimistic mutation + capture events (DD v0.3).
// =============================================================================

import { writeCaptureEvent }              from '../_shared/capture_events.ts';
import { resolveGapWindow }               from '../_shared/gap_windows.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import type {
  ResolveGapWindowInput,
  ResolveGapWindowOutput,
  GapTerminalStatus,
  GapResolutionPath,
} from '../_shared/types.ts';
import type { ErrorCode } from '../_shared/types.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface ValidationResult {
  valid:  boolean;
  errors: string[];
}

const VALID_RESOLUTION_STATUSES: GapTerminalStatus[] = ['resolved', 'unresolvable'];
const VALID_RESOLUTION_PATHS: GapResolutionPath[]    = ['web', 'email-backfill', 'none'];

function validateInput(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const input = body as Record<string, unknown>;

  if (!input.provider_id || typeof input.provider_id !== 'string') {
    errors.push('provider_id is required (uuid string)');
  }

  if (!input.gap_start || typeof input.gap_start !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.gap_start as string)) {
    errors.push('gap_start is required in YYYY-MM-DD format');
  }

  if (!input.gap_end || typeof input.gap_end !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.gap_end as string)) {
    errors.push('gap_end is required in YYYY-MM-DD format');
  }

  if (!input.resolution_status || typeof input.resolution_status !== 'string' ||
      !VALID_RESOLUTION_STATUSES.includes(input.resolution_status as GapTerminalStatus)) {
    errors.push('resolution_status must be "resolved" or "unresolvable"');
  }

  if (!input.resolution_path || typeof input.resolution_path !== 'string' ||
      !VALID_RESOLUTION_PATHS.includes(input.resolution_path as GapResolutionPath)) {
    errors.push('resolution_path must be "web", "email-backfill", or "none"');
  }

  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    errors.push('notes must be a string when provided');
  }

  return { valid: errors.length === 0, errors };
}

async function handleResolve(input: ResolveGapWindowInput): Promise<Response> {
  const result = await resolveGapWindow(
    input.provider_id,
    input.gap_start,
    input.gap_end,
    input.resolution_status,
    input.resolution_path,
    input.notes ?? null,
  );

  if (!result.success) {
    const statusMap: Record<string, { code: ErrorCode; http: number }> = {
      provider_not_found: { code: 'VALIDATION_ERROR',   http: 404 },
      not_found:          { code: 'VALIDATION_ERROR',   http: 404 },
      already_terminal:   { code: 'VALIDATION_ERROR',   http: 422 },
      conflict:           { code: 'TRANSIENT_DB_ERROR', http: 409 },
      db_error:           { code: 'SYSTEM_ERROR',       http: 500 },
    };

    const mapped = statusMap[result.reason] ?? statusMap.db_error;

    await writeCaptureEvent({
      provider_id: input.provider_id,
      article_id:  null,
      event_type:  'ingestion_failed',
      error_code:  mapped.code,
      metadata:    {
        context: 'sl_resolve_gap_window',
        reason:  result.reason,
        message: result.message,
      },
    });

    return errorResponse(
      {
        error_code: mapped.code,
        message:    result.message,
        retryable:  result.reason === 'conflict',
        event_id:   null,
      },
      mapped.http,
    );
  }

  await writeCaptureEvent({
    provider_id: input.provider_id,
    article_id:  null,
    event_type:  'ingestion_succeeded',
    metadata:    {
      context:            'sl_resolve_gap_window',
      gap_start:          input.gap_start,
      gap_end:            input.gap_end,
      resolution_status:  input.resolution_status,
      resolution_path:    input.resolution_path,
      notes:              input.notes ?? null,
    },
  });

  const output: ResolveGapWindowOutput = {
    provider_id:       input.provider_id,
    gap_start:         input.gap_start,
    gap_end:           input.gap_end,
    resolution_status: input.resolution_status,
    resolution_path:   input.resolution_path,
  };

  return successResponse(output);
}

Deno.serve(async (req: Request): Promise<Response> => {

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed — POST only' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:    'Request body must be valid JSON',
        retryable:  false,
        event_id:   null,
      },
      400,
    );
  }

  const validation = validateInput(body);
  if (!validation.valid) {
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:    `Input validation failed: ${validation.errors.join('; ')}`,
        retryable:  false,
        event_id:   null,
      },
      422,
    );
  }

  try {
    return await handleResolve(body as ResolveGapWindowInput);
  } catch (err) {
    console.error('[sl_resolve_gap_window] unhandled exception', err);
    return errorResponse(
      {
        error_code: 'SYSTEM_ERROR',
        message:    'Unhandled internal error. The failure has been logged.',
        retryable:  true,
        event_id:   null,
      },
      500,
    );
  }
});
