// =============================================================================
// Signal Ledger — sl_resolve_gap_window Edge Function
// MCP tool: sl_resolve_gap_window (sl_mcp_tool_signatures_v1.md)
// Functional Spec v1.0 §7 — gap-window optimistic JSONB mutation
//
// Step 7: Resolves a gap window on sl_provider_records.gap_windows JSONB
// array with optimistic locking via updated_at.
//
// Input: provider_id, gap_start, gap_end, resolution_status, resolution_path, notes?
// Side effects: updates gap_windows JSONB; writes sl_capture_events
// =============================================================================

import { writeCaptureEvent }                       from '../_shared/capture_events.ts';
import { resolveGapWindow }                        from '../_shared/gap_windows.ts';
import { successResponse, errorResponse }          from '../_shared/response.ts';
import type {
  ResolveGapWindowInput,
  ResolveGapWindowOutput,
  GapTerminalStatus,
  GapResolutionPath,
} from '../_shared/types.ts';

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core resolution logic
// ---------------------------------------------------------------------------

async function handleResolve(input: ResolveGapWindowInput): Promise<Response> {
  // -----------------------------------------------------------------------
  // 1. Attempt optimistic gap window resolution
  // -----------------------------------------------------------------------
  const result = await resolveGapWindow(
    input.provider_id,
    input.gap_start,
    input.gap_end,
    input.resolution_status,
    input.resolution_path,
    input.notes ?? null,
  );

  // -----------------------------------------------------------------------
  // 2. Handle failure cases
  // -----------------------------------------------------------------------
  if (!result.success) {
    const statusMap: Record<string, { code: string; http: number }> = {
      provider_not_found: { code: 'VALIDATION_ERROR',   http: 404 },
      not_found:          { code: 'VALIDATION_ERROR',   http: 404 },
      already_terminal:   { code: 'VALIDATION_ERROR',   http: 422 },
      conflict:           { code: 'TRANSIENT_DB_ERROR', http: 409 },
      db_error:           { code: 'SYSTEM_ERROR',       http: 500 },
    };

    const mapped = statusMap[result.reason] ?? statusMap.db_error;

    // Write a capture event for the failed resolution attempt
    await writeCaptureEvent({
      provider_id:                     input.provider_id,
      article_id:                      null,
      event_type:                      'ingestion_failed',
      event_status:                    result.reason === 'conflict' ? 'failed' : 'unresolvable',
      ingestion_source:                'mcp-api',
      source_vs_system_classification: result.reason === 'conflict' ? 'system-failed' : 'not-applicable',
      failure_category:                result.reason === 'conflict' ? 'unknown' : 'unknown',
      event_notes:                     `gap_resolution_failed: ${result.reason} — ${result.message}`,
    });

    return errorResponse(
      {
        error_code: mapped.code as 'VALIDATION_ERROR' | 'TRANSIENT_DB_ERROR' | 'SYSTEM_ERROR',
        message:    result.message,
        retryable:  result.reason === 'conflict',
        event_id:   null,
      },
      mapped.http,
    );
  }

  // -----------------------------------------------------------------------
  // 3. Success — write capture event + return
  // -----------------------------------------------------------------------
  const eventId = await writeCaptureEvent({
    provider_id:                     input.provider_id,
    article_id:                      null,
    event_type:                      'ingestion_succeeded',
    event_status:                    'resolved',
    ingestion_source:                'mcp-api',
    source_vs_system_classification: 'not-applicable',
    event_notes: [
      `gap_window_resolved: ${input.gap_start}/${input.gap_end}`,
      `resolution_status=${input.resolution_status}`,
      `resolution_path=${input.resolution_path}`,
      input.notes ? `notes=${input.notes}` : null,
    ].filter(Boolean).join('; '),
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

// ---------------------------------------------------------------------------
// Edge Function entrypoint
// ---------------------------------------------------------------------------
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
