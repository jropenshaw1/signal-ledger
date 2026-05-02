// =============================================================================
// Signal Ledger — sl_ingest_article Edge Function
// Implements: MCP tool sl_ingest_article (sl_mcp_tool_signatures_v1.md)
// Functional Spec v1.0 §1-§5, Appendix A (happy path), Appendix B (failure path)
//
// Step 2 scope:
//   - email-backfill happy path: complete, partial, preview-only
//   - article-write failure path: all error codes, correct HTTP status
//   - duplicate detection: app-layer guard + DB constraint backstop
//   - embedding_status = 'pending' set post-commit for complete/partial
//   - capture event sequence: started -> succeeded|failed -> embedding_queued
//   - provider record update: non-atomic, non-fatal (Step 8 hardens)
//
// Step 2 explicit defers (not bugs — intentional scope boundaries):
//   - web ingestion (ingestion_source = 'web'): returns 501 — Step 5
//   - retry chain enforcement (retry_of_event_id): accepted, logged — Step 6
//   - gap window resolution (gap_window_id): accepted, gap_resolved=false — Step 7
//   - structured observability fields (duration_ms): Step 8
// =============================================================================

import { writeCaptureEvent }                  from '../_shared/capture_events.ts';
import { mapErrorToCode, buildErrorMessage }  from '../_shared/error_mapper.ts';
import { successResponse, errorResponse,
         httpStatusForErrorCode }             from '../_shared/response.ts';
import { getServiceClient }                   from '../_shared/supabase.ts';
import type {
  IngestArticleInput,
  IngestArticleOutput,
  ContentType,
  CaptureCompleteness,
  FailureCategory,
  ErrorShape,
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

function validateInput(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const input = body as Record<string, unknown>;

  if (!input.provider_id || typeof input.provider_id !== 'string') {
    errors.push('provider_id is required (uuid string)');
  }

  const source = input.ingestion_source as string | undefined;
  if (!source || !['web', 'email-backfill'].includes(source)) {
    errors.push('ingestion_source must be "web" or "email-backfill"');
  }

  if (source === 'web') {
    if (!input.url || typeof input.url !== 'string') {
      errors.push('url is required when ingestion_source = web');
    }
    if (input.content_payload !== undefined) {
      errors.push(
        'content_payload must not be supplied when ingestion_source = web ' +
        '(v1 does not support hybrid ingestion)'
      );
    }
  }

  if (source === 'email-backfill') {
    const cp = input.content_payload as Record<string, unknown> | undefined;

    if (!cp || typeof cp !== 'object') {
      errors.push('content_payload is required when ingestion_source = email-backfill');
    } else {
      if (!cp.title || typeof cp.title !== 'string') {
        errors.push('content_payload.title is required for email-backfill');
      }

      const dateStr = cp.published_date as string | undefined;
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        errors.push('content_payload.published_date is required in YYYY-MM-DD format');
      }

      const completeness = cp.capture_completeness as string | undefined;
      if (!completeness || !['complete', 'preview-only', 'partial'].includes(completeness)) {
        errors.push(
          'content_payload.capture_completeness must be "complete", "preview-only", or "partial"'
        );
      }

      if (completeness && completeness !== 'preview-only') {
        if (!cp.body_text || typeof cp.body_text !== 'string') {
          errors.push('content_payload.body_text is required unless capture_completeness = preview-only');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Content type inference
// ---------------------------------------------------------------------------
// MCP signature v1 does not expose content_type as a caller field (locked).
// Inference rule for v1 (single provider, Nate B. Jones):
//   email-backfill -> 'Nate-executive-briefing' (briefings are emailed)
//   web            -> 'Nate-feature-article'    (features are web-published)
//
// TODO: Flag to spec review before Step 5 (web fetch). If Nate ships feature
// articles via email in future, expose content_type in a MCP signature revision.
function inferContentType(source: string): ContentType {
  return source === 'email-backfill'
    ? 'Nate-executive-briefing'
    : 'Nate-feature-article';
}

// ---------------------------------------------------------------------------
// Duplicate detection (app-layer guard)
// DB unique constraint uq_sla_provider_title_date is the authoritative backstop.
// Step 4 implements full idempotency key enforcement on (provider_id, external_id).
// ---------------------------------------------------------------------------
async function findExistingArticle(
  provider_id:    string,
  title:          string,
  published_date: string
): Promise<string | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('sl_articles')
    .select('article_id')
    .eq('provider_id',    provider_id)
    .eq('title',          title)
    .eq('published_date', published_date)
    .maybeSingle();

  return (data as { article_id: string } | null)?.article_id ?? null;
}

// ---------------------------------------------------------------------------
// Provider record update
// Non-atomic fetch-then-update. Non-fatal: failure never blocks ingestion.
// In v1 single-provider sequential ingestion the race window is negligible.
// Step 8 converts this to an atomic SQL function via RPC.
// ---------------------------------------------------------------------------
async function updateProviderRecord(provider_id: string): Promise<void> {
  const supabase = getServiceClient();

  const { data: current, error: fetchErr } = await supabase
    .from('sl_provider_records')
    .select('article_count')
    .eq('provider_id', provider_id)
    .single();

  if (fetchErr) {
    console.warn('[sl_ingest_article] provider record fetch failed (non-fatal)', {
      provider_id,
      error: fetchErr,
    });
    return;
  }

  const newCount = ((current as { article_count: number } | null)?.article_count ?? 0) + 1;
  const today    = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const { error: updateErr } = await supabase
    .from('sl_provider_records')
    .update({
      article_count:       newCount,
      last_ingestion_date: today,
    })
    .eq('provider_id', provider_id);

  if (updateErr) {
    console.warn('[sl_ingest_article] provider record update failed (non-fatal)', {
      provider_id,
      error: updateErr,
    });
  }
}

// ---------------------------------------------------------------------------
// Core ingestion logic
// Implements Appendix A (happy path) and Appendix B (failure path).
// ---------------------------------------------------------------------------
async function ingestArticle(input: IngestArticleInput): Promise<Response> {
  const supabase  = getServiceClient();
  const startedAt = Date.now();

  // web ingestion not implemented in Step 2 — Step 5
  if (input.ingestion_source === 'web') {
    return errorResponse(
      {
        error_code: 'SYSTEM_ERROR',
        message:
          'Web ingestion (ingestion_source = "web") is not yet implemented. ' +
          'Use ingestion_source = "email-backfill" with content_payload in Step 2.',
        retryable: false,
        event_id:  null,
      },
      501
    );
  }

  // email-backfill — content_payload validated present at this point
  const cp             = input.content_payload!;
  const title          = cp.title;
  const published_date = cp.published_date;
  const completeness   = cp.capture_completeness as CaptureCompleteness;
  const body_text      = cp.body_text ?? null;
  const content_type   = inferContentType(input.ingestion_source);

  // -------------------------------------------------------------------------
  // [Appendix A step 2] ingestion_started event
  // Written BEFORE any article write attempt — Functional Spec §1.
  // -------------------------------------------------------------------------
  const startedEventId = await writeCaptureEvent({
    provider_id:                     input.provider_id,
    article_id:                      null,
    event_type:                      'ingestion_started',
    event_status:                    'success',
    ingestion_source:                input.ingestion_source,
    attempted_url:                   input.url         ?? null,
    attempted_title:                 title,
    attempted_published_date:        published_date,
    source_vs_system_classification: 'not-applicable',
    event_notes: input.retry_of_event_id
      ? `Retry of event_id=${input.retry_of_event_id}` // Step 6 enforces chain
      : null,
  });

  // -------------------------------------------------------------------------
  // App-layer duplicate guard
  // Step 4 adds full idempotency key enforcement on (provider_id, external_id).
  // -------------------------------------------------------------------------
  const existingId = await findExistingArticle(
    input.provider_id,
    title,
    published_date
  );

  if (existingId) {
    const dupEventId = await writeCaptureEvent({
      provider_id:                     input.provider_id,
      article_id:                      existingId,
      event_type:                      'ingestion_failed',
      event_status:                    'duplicate-detected',
      ingestion_source:                input.ingestion_source,
      attempted_url:                   input.url ?? null,
      attempted_title:                 title,
      attempted_published_date:        published_date,
      source_vs_system_classification: 'not-applicable',
      failure_category:                'duplicate',
      event_notes:                     `Duplicate of article_id=${existingId}`,
    });

    return successResponse<IngestArticleOutput>({
      article_id:           existingId,
      event_id:             dupEventId ?? startedEventId ?? '',
      capture_completeness: completeness,
      status:               'duplicate-detected',
      failure_category:     'duplicate',
      gap_resolved:         false,
    });
  }

  // -------------------------------------------------------------------------
  // [Appendix A step 3] Article write — atomic INSERT
  // A single INSERT is inherently atomic in PostgreSQL.
  // embedding_status is NOT set here — set post-commit per Appendix A step 5.
  // -------------------------------------------------------------------------
  const { data: articleData, error: articleError } = await supabase
    .from('sl_articles')
    .insert({
      provider_id:          input.provider_id,
      content_type:         content_type,
      title:                title,
      published_date:       published_date,
      ingestion_date:       new Date().toISOString(),
      ingestion_source:     input.ingestion_source,
      capture_completeness: completeness,
      body_text:            body_text,
      // embedding_status intentionally absent — set to 'pending' post-commit
    })
    .select('article_id')
    .single();

  const durationMs = Date.now() - startedAt;

  // -------------------------------------------------------------------------
  // [Appendix B] Article write failure path
  // -------------------------------------------------------------------------
  if (articleError) {
    const mapped = mapErrorToCode(articleError);

    const failedEventId = await writeCaptureEvent({
      provider_id:                     input.provider_id,
      article_id:                      null,
      event_type:                      'ingestion_failed',
      event_status:                    'failed',
      ingestion_source:                input.ingestion_source,
      attempted_url:                   input.url ?? null,
      attempted_title:                 title,
      attempted_published_date:        published_date,
      source_vs_system_classification: 'system-failed',
      failure_category:                mapped.failure_category as FailureCategory,
      raw_error:                       JSON.stringify(articleError),
      event_notes:                     `duration_ms=${durationMs}`,
    });

    const errorShape: ErrorShape = {
      error_code: mapped.error_code,
      message:    buildErrorMessage(mapped.error_code, articleError),
      retryable:  mapped.retryable,
      event_id:   failedEventId,
    };

    return errorResponse(errorShape, httpStatusForErrorCode(mapped.error_code));
  }

  // -------------------------------------------------------------------------
  // Happy path — article committed
  // -------------------------------------------------------------------------
  const article_id = (articleData as { article_id: string }).article_id;

  // [Appendix A step 4] ingestion_succeeded event
  const succeededEventId = await writeCaptureEvent({
    provider_id:                     input.provider_id,
    article_id:                      article_id,
    event_type:                      'ingestion_succeeded',
    event_status:                    'success',
    ingestion_source:                input.ingestion_source,
    attempted_url:                   input.url ?? null,
    attempted_title:                 title,
    attempted_published_date:        published_date,
    source_vs_system_classification: 'not-applicable',
    event_notes:                     `duration_ms=${durationMs}`,
  });

  // -------------------------------------------------------------------------
  // [Appendix A step 5] embedding_status + embedding_queued event
  // preview-only articles: no body_text -> embedding never applies -> NULL.
  // complete / partial:    set 'pending' -> async worker picks up.
  // -------------------------------------------------------------------------
  let embeddingEventId: string | null = null;

  if (completeness !== 'preview-only') {
    const { error: statusError } = await supabase
      .from('sl_articles')
      .update({ embedding_status: 'pending' })
      .eq('article_id', article_id);

    if (statusError) {
      // Non-fatal. The embedding worker (Step 5) will add a reconciliation
      // sweep: SELECT WHERE capture_completeness != 'preview-only'
      // AND embedding_status IS NULL to catch orphaned-status rows.
      console.error('[sl_ingest_article] embedding_status update failed (non-fatal)', {
        article_id,
        error: statusError,
      });
    }

    embeddingEventId = await writeCaptureEvent({
      provider_id:                     input.provider_id,
      article_id:                      article_id,
      event_type:                      'embedding_queued',
      event_status:                    'success',
      ingestion_source:                input.ingestion_source,
      source_vs_system_classification: 'not-applicable',
      event_notes:
        'Deferred async — 3 attempts: Attempt 1 -> wait 2s -> Attempt 2 -> wait 8s -> Attempt 3 -> terminal',
    });
  }

  // [Appendix A step 6] Provider record update (non-fatal)
  await updateProviderRecord(input.provider_id);

  // Return ingestion_succeeded event_id as the canonical reference
  const outputStatus: IngestArticleOutput['status'] =
    completeness === 'preview-only' ? 'preview-only'
    : completeness === 'partial'    ? 'partial'
    : 'success';

  return successResponse<IngestArticleOutput>({
    article_id:           article_id,
    event_id:             succeededEventId ?? embeddingEventId ?? startedEventId ?? '',
    capture_completeness: completeness,
    status:               outputStatus,
    gap_resolved:         false, // Step 7
  });
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
      { status: 405, headers: { 'Content-Type': 'application/json' } }
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
      400
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
      422
    );
  }

  try {
    return await ingestArticle(body as IngestArticleInput);
  } catch (err) {
    console.error('[sl_ingest_article] unhandled exception', err);
    return errorResponse(
      {
        error_code: 'SYSTEM_ERROR',
        message:    'Unhandled internal error. The failure has been logged.',
        retryable:  true,
        event_id:   null,
      },
      500
    );
  }
});
