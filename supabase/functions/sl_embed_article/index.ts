// =============================================================================
// Signal Ledger — sl_embed_article Edge Function
// Functional Spec v1.1 §2 — deferred embedding pipeline; DD v0.3 E8 sl_signpost_embeddings.
//
// One row per (article_id, model_id): semantic embedding of article body_text,
// or title-only / title+excerpt for preview-only captures.
//
// Retry: Attempt 1 → wait 2s → Attempt 2 → wait 8s → Attempt 3 → terminal.
// Invocation: POST { article_id: uuid }
// =============================================================================

import { writeCaptureEvent }                 from '../_shared/capture_events.ts';
import {
  generateEmbedding,
  getEmbeddingModel,
  type EmbeddingResponse,
}                                             from '../_shared/embedding_client.ts';
import { mapEmbeddingHttpStatus,
         mapErrorToCode }                       from '../_shared/error_mapper.ts';
import { successResponse, errorResponse }      from '../_shared/response.ts';
import { getServiceClient }                    from '../_shared/supabase.ts';

const RETRY_WAIT_MS = [0, 2_000, 8_000];
const MAX_ATTEMPTS  = 3;
const MODEL_ID      = () => getEmbeddingModel();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

function buildEmbedInput(title: string, body_text: string | null, completeness: string): string {
  if (completeness === 'preview-only' || !body_text) {
    return title.trim();
  }
  return body_text;
}

function vectorToPgString(v: number[]): string {
  return JSON.stringify(v);
}

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

  const { data: articleData, error: fetchErr } = await supabase
    .from('sl_articles')
    .select(
      'article_id, provider_id, title, body_text, embedding_status, capture_completeness',
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
    title:                string;
    body_text:            string | null;
    embedding_status:     string | null;
    capture_completeness: string;
  };

  const { data: existingEmb } = await supabase
    .from('sl_signpost_embeddings')
    .select('embedding_id')
    .eq('article_id', articleId)
    .eq('model_id', MODEL_ID())
    .maybeSingle();

  if (existingEmb && article.embedding_status === 'complete') {
    return successResponse({
      article_id:       articleId,
      embedding_status: 'complete',
      status:           'already-complete',
      event_id:         null as string | null,
    });
  }

  if (article.embedding_status === 'pending' ||
      article.embedding_status === 'processing' ||
      article.embedding_status === 'failed') {
    // eligible
  } else if (article.embedding_status === 'complete' && !existingEmb) {
    // reconcile: FS says complete implies E8 row; continue to (re-)write
    console.warn('[sl_embed_article] embedding_status complete but missing E8 row — rebuilding', {
      articleId,
    });
  } else {
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:
          `Article ${articleId} has embedding_status="${article.embedding_status}"; cannot embed.`,
        retryable: false,
        event_id:  null,
      },
      422,
    );
  }

  const embedText = buildEmbedInput(article.title, article.body_text, article.capture_completeness);
  if (embedText.length === 0) {
    return errorResponse(
      {
        error_code: 'VALIDATION_ERROR',
        message:    `Article ${articleId} has empty embeddable content.`,
        retryable:  false,
        event_id:   null,
      },
      422,
    );
  }

  await supabase
    .from('sl_articles')
    .update({ embedding_status: 'processing' })
    .eq('article_id', articleId);

  let lastFailEventId: string | null = null;
  let lastResult: EmbeddingResponse | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS[attempt - 1]));
    }

    lastResult = await generateEmbedding(embedText, apiKey);

    if (lastResult.success) {
      const provenance = {
        model_version:       lastResult.model,
        input_token_count:   lastResult.usage.prompt_tokens,
        total_tokens:       lastResult.usage.total_tokens,
      };

      const { error: embErr } = await supabase.from('sl_signpost_embeddings').upsert(
        {
          article_id: articleId,
          model_id:   MODEL_ID(),
          embedding:   vectorToPgString(lastResult.embedding),
          provenance,
        },
        { onConflict: 'article_id,model_id' },
      );

      if (embErr) {
        const mapped = mapErrorToCode(embErr);
        await writeCaptureEvent({
          provider_id: article.provider_id,
          article_id:  articleId,
          event_type:  'embedding_failed',
          error_code:  mapped.error_code,
          metadata:    { phase: 'e8_write', attempt, constraint: mapped.constraint },
        });

        await supabase
          .from('sl_articles')
          .update({ embedding_status: 'failed' })
          .eq('article_id', articleId);

        return errorResponse(
          {
            error_code: mapped.error_code,
            message:
              mapped.error_code === 'SCHEMA_VIOLATION'
                ? 'Could not persist embedding row.'
                : 'Database error while saving embedding.',
            retryable: mapped.retryable,
            event_id:  null,
          },
          mapped.error_code === 'TRANSIENT_DB_ERROR' ? 503 : 422,
        );
      }

      const { error: stErr } = await supabase
        .from('sl_articles')
        .update({ embedding_status: 'complete' })
        .eq('article_id', articleId);

      if (stErr) {
        console.error('[sl_embed_article] failed to mark article complete', { articleId, stErr });
      }

      const successEventId = await writeCaptureEvent({
        provider_id: article.provider_id,
        article_id:  articleId,
        event_type:  'embedding_succeeded',
        metadata:    { attempt, model_id: MODEL_ID(), provenance },
      });

      return successResponse({
        article_id:       articleId,
        embedding_status: 'complete',
        status:           'success',
        event_id:         successEventId,
      });
    }

    const mapped = mapEmbeddingHttpStatus(lastResult.httpStatus);

    const failEventId = await writeCaptureEvent({
      provider_id: article.provider_id,
      article_id:  articleId,
      event_type:  'embedding_failed',
      error_code:  mapped.error_code,
      metadata:    {
        attempt,
        httpStatus: lastResult.httpStatus,
        message:    lastResult.message.slice(0, 2_048),
      },
    });

    lastFailEventId = failEventId;

    if (!mapped.retryable) {
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

    if (attempt < MAX_ATTEMPTS && failEventId) {
      await writeCaptureEvent({
        provider_id:        article.provider_id,
        article_id:         articleId,
        event_type:         'retry_attempted',
        retry_of_event_id:  failEventId,
        metadata:           { next_wait_ms: RETRY_WAIT_MS[attempt] },
      });
    }
  }

  await supabase
    .from('sl_articles')
    .update({ embedding_status: 'failed' })
    .eq('article_id', articleId);

  return errorResponse(
    {
      error_code: 'EMBEDDING_FAILURE',
      message:    `All ${MAX_ATTEMPTS} embedding attempts failed.`,
      retryable:  false,
      event_id:   lastFailEventId,
    },
    502,
  );
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
