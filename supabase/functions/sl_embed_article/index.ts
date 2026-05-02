// =============================================================================
// Signal Ledger — sl_embed_article Edge Function
// Functional Spec v1.0 §2, Appendix A step 6, Appendix C
//
// Step 5: Async embedding worker. Picks up a single article by article_id,
// generates the article-level embedding via OpenAI text-embedding-3-small,
// and writes provenance metadata to sl_articles. If structured_signposts
// are present, embeds each signpost and INSERTs to sl_signpost_embeddings.
//
// Retry model (Spec §2): 3 total attempts.
//   Attempt 1 → fail → wait 2s → Attempt 2 → fail → wait 8s → Attempt 3 → terminal.
// Non-retryable failures (4xx) terminate immediately.
//
// Step 6 scope:
//   - retry_attempted events use formal retry_of_event_id column
//   - event_notes no longer carries retry linkage (moved to formal column)
//
// Invocation: POST { article_id: uuid }
// Triggered by: pg_cron, manual call, or orchestrator.
// =============================================================================

import { writeCaptureEvent }              from '../_shared/capture_events.ts';
import {
  generateEmbedding,
  parseEmbeddingApiResponse,
  getEmbeddingModel,
  getEmbeddingVersion,
  type EmbeddingResponse,
}                                          from '../_shared/embedding_client.ts';
import { mapEmbeddingHttpStatus }          from '../_shared/error_mapper.ts';
import { sha256Hex }                       from '../_shared/hash.ts';
import { successResponse, errorResponse }  from '../_shared/response.ts';
import { getServiceClient }                from '../_shared/supabase.ts';
import type {
  IngestionSource,
  ErrorShape,
} from '../_shared/types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wait durations between retry attempts (ms). Index 0 unused (attempt 1 has no wait). */
const RETRY_WAIT_MS = [0, 2_000, 8_000];

/** Maximum embedding attempts per invocation (Spec §2). */
const MAX_ATTEMPTS = 3;

/** Provider name for sl_signpost_embeddings (v1 single-provider). */
const SIGNPOST_PROVIDER_ID = 'nate';

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------------------------------------------------------------------------
// Signpost JSONB shape (mirrors sl_articles.structured_signposts entries)
// ---------------------------------------------------------------------------
interface SignpostEntry {
  signpost_id:       string;
  signpost_text:     string;
  extraction_method: string;
  extracted_at:      string;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(body: unknown): { valid: boolean; article_id?: string; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object' };
  }
  const input = body as Record<string, unknown>;
  if (!input.article_id || typeof input.article_id !== 'string') {
    return { valid: false, error: 'article_id is required (uuid string)' };
  }
  return { valid: true, article_id: input.article_id };
}

// ---------------------------------------------------------------------------
// Signpost embedding (best-effort, non-blocking)
// ---------------------------------------------------------------------------

/**
 * Embeds each signpost from structured_signposts and INSERTs into
 * sl_signpost_embeddings. Failures are logged but do not affect the
 * article-level embedding_status.
 *
 * Idempotency: uq_signpost_provider (signpost_id, provider_id) prevents
 * duplicates. If the content_hash matches the existing row, skip.
 */
async function embedSignposts(
  articleId:        string,
  signposts:        SignpostEntry[],
  apiKey:           string,
  ingestionSource:  IngestionSource,
  providerId:       string,
): Promise<{ embedded: number; skipped: number; failed: number }> {
  const supabase = getServiceClient();
  let embedded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < signposts.length; i++) {
    const sp = signposts[i];

    if (!sp.signpost_id || !sp.signpost_text) {
      console.warn('[sl_embed_article] signpost missing id or text, skipping', {
        articleId,
        index: i,
      });
      skipped++;
      continue;
    }

    const contentHash = await sha256Hex(sp.signpost_text);

    // Check if an embedding already exists for this signpost+provider
    const { data: existing } = await supabase
      .from('sl_signpost_embeddings')
      .select('signpost_embedding_id, content_hash')
      .eq('signpost_id', sp.signpost_id)
      .eq('provider_id', SIGNPOST_PROVIDER_ID)
      .maybeSingle();

    if (existing) {
      const existingRow = existing as { signpost_embedding_id: string; content_hash: string };
      if (existingRow.content_hash === contentHash) {
        // Content unchanged — skip re-embedding
        skipped++;
        continue;
      }
      // Content changed — will upsert below (delete + insert for simplicity)
      await supabase
        .from('sl_signpost_embeddings')
        .delete()
        .eq('signpost_embedding_id', existingRow.signpost_embedding_id);
    }

    // Generate embedding for signpost text
    const result = await generateEmbedding(sp.signpost_text, apiKey);

    if (!result.success) {
      console.error('[sl_embed_article] signpost embedding failed', {
        articleId,
        signpostId: sp.signpost_id,
        httpStatus: result.httpStatus,
        message:    result.message,
      });
      failed++;
      continue;
    }

    // INSERT into sl_signpost_embeddings
    const { error: insertErr } = await supabase
      .from('sl_signpost_embeddings')
      .insert({
        article_id:        articleId,
        signpost_id:       sp.signpost_id,
        signpost_text:     sp.signpost_text,
        signpost_position: i + 1, // 1-based
        content_hash:      contentHash,
        provider_id:       SIGNPOST_PROVIDER_ID,
        embedding_model:   getEmbeddingModel(),
        embedding_version: getEmbeddingVersion(),
        embedding:         JSON.stringify(result.embedding),
      });

    if (insertErr) {
      console.error('[sl_embed_article] signpost INSERT failed', {
        articleId,
        signpostId: sp.signpost_id,
        error:      insertErr,
      });
      failed++;
    } else {
      embedded++;
    }
  }

  console.info('[sl_embed_article] signpost embedding complete', {
    articleId,
    total: signposts.length,
    embedded,
    skipped,
    failed,
  });

  return { embedded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Core embedding logic
// ---------------------------------------------------------------------------

async function embedArticle(articleId: string): Promise<Response> {
  const supabase = getServiceClient();
  const apiKey   = Deno.env.get('OPENAI_API_KEY');

  if (!apiKey) {
    console.error('[sl_embed_article] OPENAI_API_KEY not set');
    return errorResponse(
      {
        error_code: 'SYSTEM_ERROR',
        message:    'OPENAI_API_KEY environment variable is not configured.',
        retryable:  false,
        event_id:   null,
      },
      500,
    );
  }

  // -------------------------------------------------------------------------
  // 1. Fetch article
  // -------------------------------------------------------------------------
  const { data: articleData, error: fetchErr } = await supabase
    .from('sl_articles')
    .select(
      'article_id, provider_id, body_text, embedding_status, content_hash, ' +
      'structured_signposts, ingestion_source, capture_completeness'
    )
    .eq('article_id', articleId)
    .single();

  if (fetchErr || !articleData) {
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:    `Article not found: ${articleId}`,
        retryable:  false,
        event_id:   null,
      },
      404,
    );
  }

  const article = articleData as {
    article_id:           string;
    provider_id:          string;
    body_text:            string | null;
    embedding_status:     string | null;
    content_hash:         string | null;
    structured_signposts: SignpostEntry[] | null;
    ingestion_source:     string;
    capture_completeness: string;
  };

  // -------------------------------------------------------------------------
  // 2. Guard: embedding_status must be 'pending' or 'processing' (stale recovery)
  // -------------------------------------------------------------------------
  if (article.embedding_status === 'complete') {
    return successResponse({
      article_id:       articleId,
      embedding_status: 'complete',
      status:           'already-complete',
      event_id:         null,
    });
  }

  if (article.embedding_status === 'failed') {
    // Manual re-trigger of a failed article: reset to processing and retry.
    // This supports the "manual triage" path from Appendix C.
    console.info('[sl_embed_article] re-triggering failed article', { articleId });
  }

  if (article.embedding_status !== 'pending' &&
      article.embedding_status !== 'processing' &&
      article.embedding_status !== 'failed') {
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:    `Article ${articleId} has embedding_status="${article.embedding_status}"; expected "pending", "processing", or "failed".`,
        retryable:  false,
        event_id:   null,
      },
      422,
    );
  }

  if (!article.body_text) {
    // preview-only articles should never reach here (embedding_status should be NULL).
    // If they do, it's a logic error upstream — fail fast.
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:    `Article ${articleId} has no body_text — cannot generate embedding.`,
        retryable:  false,
        event_id:   null,
      },
      422,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Set embedding_status = 'processing'
  // -------------------------------------------------------------------------
  const { error: processingErr } = await supabase
    .from('sl_articles')
    .update({ embedding_status: 'processing' })
    .eq('article_id', articleId);

  if (processingErr) {
    console.error('[sl_embed_article] failed to set processing status', {
      articleId,
      error: processingErr,
    });
    // Non-fatal: continue with the embedding attempt.
  }

  // -------------------------------------------------------------------------
  // 4. Compute content_hash for idempotent re-embedding check
  // -------------------------------------------------------------------------
  const bodyText       = article.body_text;
  const newContentHash = await sha256Hex(bodyText);
  const ingestionSrc   = article.ingestion_source as IngestionSource;

  // -------------------------------------------------------------------------
  // 5. Retry loop — 3 total attempts (Spec §2, Appendix C)
  // -------------------------------------------------------------------------
  let lastEventId:       string | null = null;
  let lastResult:        EmbeddingResponse | null = null;
  let succeeded          = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Wait before retry (not before first attempt)
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS[attempt - 1]));
    }

    console.info('[sl_embed_article] embedding attempt', {
      articleId,
      attempt,
      maxAttempts: MAX_ATTEMPTS,
    });

    lastResult = await generateEmbedding(bodyText, apiKey);

    // --- Success path ---
    if (lastResult.success) {
      // Atomic UPDATE: set all provenance fields + embedding_status together.
      // ck_sla_embedding_provenance requires all four non-null simultaneously.
      // ck_sla_embedding_status_complete requires status='complete' when embedding is non-null.
      const { error: updateErr } = await supabase
        .from('sl_articles')
        .update({
          embedding:         JSON.stringify(lastResult.embedding),
          embedding_model:   getEmbeddingModel(),
          embedding_version: getEmbeddingVersion(),
          content_hash:      newContentHash,
          embedding_status:  'complete',
        })
        .eq('article_id', articleId);

      if (updateErr) {
        console.error('[sl_embed_article] article embedding UPDATE failed', {
          articleId,
          attempt,
          error: updateErr,
        });
        // DB write failed — mark as failed and return
        await supabase
          .from('sl_articles')
          .update({ embedding_status: 'failed' })
          .eq('article_id', articleId);

        const failEventId = await writeCaptureEvent({
          provider_id:                     article.provider_id,
          article_id:                      articleId,
          event_type:                      'embedding_failed',
          event_status:                    'failed',
          ingestion_source:                ingestionSrc,
          source_vs_system_classification: 'system-failed',
          failure_category:                'schema-drift',
          retry_count:                     attempt,
          raw_error:                       JSON.stringify(updateErr),
          event_notes:                     `DB write failed on attempt ${attempt} after successful API call`,
        });

        return errorResponse(
          {
            error_code: 'TRANSIENT_DB_ERROR',
            message:    'Embedding generated successfully but article UPDATE failed.',
            retryable:  true,
            event_id:   failEventId,
          },
          503,
        );
      }

      // Write embedding_succeeded event
      const successEventId = await writeCaptureEvent({
        provider_id:                     article.provider_id,
        article_id:                      articleId,
        event_type:                      'embedding_succeeded',
        event_status:                    'success',
        ingestion_source:                ingestionSrc,
        source_vs_system_classification: 'not-applicable',
        retry_count:                     attempt,
        event_notes: [
          `attempt=${attempt}`,
          `model=${lastResult.model}`,
          `prompt_tokens=${lastResult.usage.prompt_tokens}`,
          `total_tokens=${lastResult.usage.total_tokens}`,
          `content_hash=${newContentHash}`,
        ].join('; '),
      });

      lastEventId = successEventId;
      succeeded   = true;
      break;
    }

    // --- Failure path ---
    const mapped = mapEmbeddingHttpStatus(lastResult.httpStatus);

    const failEventId = await writeCaptureEvent({
      provider_id:                     article.provider_id,
      article_id:                      articleId,
      event_type:                      'embedding_failed',
      event_status:                    'failed',
      ingestion_source:                ingestionSrc,
      source_vs_system_classification: 'system-failed',
      failure_category:                'network-error',
      retry_count:                     attempt,
      raw_error:                       lastResult.message,
      event_notes:                     `attempt=${attempt}; httpStatus=${lastResult.httpStatus}; retryable=${mapped.retryable}`,
    });

    lastEventId = failEventId;

    // Non-retryable failure (4xx) — terminate immediately
    if (!mapped.retryable) {
      console.error('[sl_embed_article] non-retryable failure, terminating', {
        articleId,
        attempt,
        httpStatus: lastResult.httpStatus,
      });

      await supabase
        .from('sl_articles')
        .update({ embedding_status: 'failed' })
        .eq('article_id', articleId);

      return errorResponse(
        {
          error_code: mapped.error_code,
          message:    `Embedding failed (non-retryable): ${lastResult.message}`,
          retryable:  false,
          event_id:   failEventId,
        },
        502,
      );
    }

    // Write retry_attempted event (if not last attempt)
    // Step 6: retry_of_event_id is now a formal column, no longer in event_notes.
    if (attempt < MAX_ATTEMPTS) {
      await writeCaptureEvent({
        provider_id:                     article.provider_id,
        article_id:                      articleId,
        event_type:                      'retry_attempted',
        event_status:                    'failed',
        ingestion_source:                ingestionSrc,
        source_vs_system_classification: 'system-failed',
        failure_category:                'network-error',
        retry_count:                     attempt,
        retry_of_event_id:               failEventId,
        event_notes:                     `next_wait_ms=${RETRY_WAIT_MS[attempt]}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Terminal failure — all attempts exhausted
  // -------------------------------------------------------------------------
  if (!succeeded) {
    console.error('[sl_embed_article] all attempts exhausted', {
      articleId,
      maxAttempts: MAX_ATTEMPTS,
    });

    await supabase
      .from('sl_articles')
      .update({ embedding_status: 'failed' })
      .eq('article_id', articleId);

    return errorResponse(
      {
        error_code: 'EMBEDDING_FAILURE',
        message:    `All ${MAX_ATTEMPTS} embedding attempts failed. Manual triage required.`,
        retryable:  false,
        event_id:   lastEventId,
      },
      502,
    );
  }

  // -------------------------------------------------------------------------
  // 7. Signpost embeddings (best-effort, non-blocking)
  // If structured_signposts is non-empty, embed each signpost.
  // Failures are logged but do not revert the article-level embedding.
  // v1 email-backfill: signposts will typically be empty.
  // -------------------------------------------------------------------------
  const signposts = (article.structured_signposts ?? []) as SignpostEntry[];
  let signpostStats = { embedded: 0, skipped: 0, failed: 0 };

  if (signposts.length > 0) {
    signpostStats = await embedSignposts(
      articleId,
      signposts,
      apiKey,
      ingestionSrc,
      article.provider_id,
    );
  }

  // -------------------------------------------------------------------------
  // Success response
  // -------------------------------------------------------------------------
  return successResponse({
    article_id:       articleId,
    embedding_status: 'complete',
    status:           'success',
    event_id:         lastEventId,
    content_hash:     newContentHash,
    signposts: {
      total:    signposts.length,
      embedded: signpostStats.embedded,
      skipped:  signpostStats.skipped,
      failed:   signpostStats.failed,
    },
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
        message:    `Input validation failed: ${validation.error}`,
        retryable:  false,
        event_id:   null,
      },
      422,
    );
  }

  try {
    return await embedArticle(validation.article_id!);
  } catch (err) {
    console.error('[sl_embed_article] unhandled exception', err);
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
