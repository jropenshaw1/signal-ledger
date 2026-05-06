// =============================================================================
// Signal Ledger — sl_ingest_article Edge Function
// MCP tool: sl_ingest_article (docs/sl_mcp_tool_signatures_v1.md)
// Functional Spec v1.1 — transaction boundaries §1; errors §4; DD v0.3 schema.
//
// Step 2: email-backfill happy + failure paths; idempotency (provider_id +
// external_id); capture events DD v0.3 shape; ingestion_started → succeeded |
// failed → embedding_queued.
//
// Deferred: ingestion_source = web (fetch-from-URL ingestion).
// =============================================================================

import { writeCaptureEvent }                          from '../_shared/capture_events.ts';
import { resolveGapWindow }                           from '../_shared/gap_windows.ts';
import { mapErrorToCode, buildErrorMessage }           from '../_shared/error_mapper.ts';
import { normalizeText, sha256Hex }                      from '../_shared/hash.ts';
import { successResponse, errorResponse,
        httpStatusForErrorCode }                       from '../_shared/response.ts';
import { getServiceClient }                            from '../_shared/supabase.ts';
import type {
  IngestArticleInput,
  IngestArticleOutput,
  ContentType,
  CaptureCompleteness,
  FailureCategory,
  ErrorShape,
} from '../_shared/types.ts';

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
          '(v1 does not support hybrid ingestion)',
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
          'content_payload.capture_completeness must be "complete", "preview-only", or "partial"',
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

function inferContentType(source: string): ContentType {
  return source === 'email-backfill'
    ? 'Nate-executive-briefing'
    : 'Nate-feature-article';
}

async function deriveExternalId(
  provider_id: string,
  message_id: string | null | undefined,
  title: string,
  published_date: string,
  body_text: string | null,
): Promise<string> {
  if (message_id && message_id.trim() !== '') {
    return `email:${message_id}`;
  }

  if (body_text) {
    const normalized = normalizeText(title) + '\n' + normalizeText(body_text);
    const hash       = await sha256Hex(normalized);
    return `email_hash:${hash}`;
  }

  const stamp = normalizeText(title) + '|' + published_date + '|' + provider_id;
  const hash   = await sha256Hex(stamp);
  return `email_preview:${hash}`;
}

async function findExistingArticleByExternalId(
  provider_id: string,
  external_id: string,
): Promise<string | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('sl_articles')
    .select('article_id')
    .eq('provider_id', provider_id)
    .eq('external_id', external_id)
    .maybeSingle();

  return (data as { article_id: string } | null)?.article_id ?? null;
}

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
  const today    = new Date().toISOString().split('T')[0];

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

async function ingestArticle(input: IngestArticleInput): Promise<Response> {
  const supabase  = getServiceClient();
  const startedAt = Date.now();

  if (input.ingestion_source === 'web') {
    return errorResponse(
      {
        error_code: 'SYSTEM_ERROR',
        message:
          'Web ingestion (ingestion_source = "web") is not yet implemented — use email-backfill.',
        retryable: false,
        event_id:  null,
      },
      501,
    );
  }

  const cp             = input.content_payload!;
  const title          = cp.title;
  const published_date = cp.published_date;
  const completeness   = cp.capture_completeness as CaptureCompleteness;
  const body_text      = cp.body_text ?? null;
  const message_id     = cp.message_id ?? null;
  const content_type   = inferContentType(input.ingestion_source);

  const external_id = await deriveExternalId(
    input.provider_id,
    message_id,
    title,
    published_date,
    body_text,
  );

  const startedEventId = await writeCaptureEvent({
    provider_id:        input.provider_id,
    article_id:         null,
    event_type:         'ingestion_started',
    retry_of_event_id:  input.retry_of_event_id ?? null,
    duration_ms:        null,
    metadata:           { ingestion_source: input.ingestion_source },
  });

  const existingId = await findExistingArticleByExternalId(
    input.provider_id,
    external_id,
  );

  const elapsedAfterDupCheck = Date.now() - startedAt;

  if (existingId) {
    const dupEventId = await writeCaptureEvent({
      provider_id: input.provider_id,
      article_id:  existingId,
      event_type:  'ingestion_failed',
      error_code:  'DUPLICATE_ARTICLE',
      duration_ms: elapsedAfterDupCheck,
      metadata:    { duplicate_article_id: existingId, external_id },
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

  const { data: articleData, error: articleError } = await supabase
    .from('sl_articles')
    .insert({
      provider_id:                   input.provider_id,
      external_id,
      content_type,
      title,
      published_date,
      ingestion_date:                new Date().toISOString(),
      ingestion_source:              input.ingestion_source,
      capture_completeness:          completeness,
      url:                           null,
      body_text,
      author_signposts:              [],
      cited_claims:                  [],
      structured_technical_content:  [],
    })
    .select('article_id')
    .single();

  const durationMs = Date.now() - startedAt;

  if (articleError) {
    const mapped = mapErrorToCode(articleError);

    const failedEventId = await writeCaptureEvent({
      provider_id: input.provider_id,
      article_id:  null,
      event_type:  'ingestion_failed',
      error_code:  mapped.error_code,
      duration_ms:   durationMs,
      metadata:      {
        constraint: mapped.constraint ?? null,
      },
    });

    const errorShape: ErrorShape = {
      error_code: mapped.error_code,
      message:    buildErrorMessage(mapped.error_code, articleError, mapped.constraint),
      retryable:  mapped.retryable,
      event_id:   failedEventId,
    };

    return errorResponse(errorShape, httpStatusForErrorCode(mapped.error_code));
  }

  const article_id = (articleData as { article_id: string }).article_id;

  const succeededEventId = await writeCaptureEvent({
    provider_id: input.provider_id,
    article_id:  article_id,
    event_type:  'ingestion_succeeded',
    duration_ms: durationMs,
    metadata:    { external_id },
  });

  await writeCaptureEvent({
    provider_id: input.provider_id,
    article_id:  article_id,
    event_type:  'embedding_queued',
    duration_ms: null,
    metadata:    {
      model_id:           'text-embedding-3-small',
      embedding_deferred:   true,
    },
  });

  await updateProviderRecord(input.provider_id);

  let gapResolved = false;

  if (input.gap_window_id) {
    const parts = input.gap_window_id.split('_');
    const gapStart = parts[0];
    const gapEnd   = parts[1];

    if (gapStart && gapEnd && /^\d{4}-\d{2}-\d{2}$/.test(gapStart) && /^\d{4}-\d{2}-\d{2}$/.test(gapEnd)) {
      const gapResult = await resolveGapWindow(
        input.provider_id,
        gapStart,
        gapEnd,
        'resolved',
        'email-backfill',
      );

      if (gapResult.success) {
        gapResolved = true;
        console.info('[sl_ingest_article] gap window resolved', {
          article_id,
          gap_start: gapStart,
          gap_end:   gapEnd,
        });
      } else {
        console.warn('[sl_ingest_article] gap window resolution failed (non-fatal)', {
          article_id,
          gap_window_id: input.gap_window_id,
          reason:        gapResult.reason,
          message:       gapResult.message,
        });
      }
    } else {
      console.warn('[sl_ingest_article] gap_window_id format invalid (expected YYYY-MM-DD_YYYY-MM-DD)', {
        gap_window_id: input.gap_window_id,
      });
    }
  }

  const outputStatus: IngestArticleOutput['status'] =
    completeness === 'preview-only'
      ? 'preview-only'
      : completeness === 'partial'
      ? 'partial'
      : 'success';

  return successResponse<IngestArticleOutput>({
    article_id:           article_id,
    event_id:             succeededEventId ?? startedEventId ?? '',
    capture_completeness: completeness,
    status:               outputStatus,
    gap_resolved:         gapResolved,
  });
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
      500,
    );
  }
});
