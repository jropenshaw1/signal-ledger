// =============================================================================
// Signal Ledger — sl_embed_article Edge Function
// Functional Spec v1.1 §2 — deferred embedding pipeline; DD v0.3 E8 sl_signpost_embeddings.
//
// v2: Adds chunking support for articles that exceed the 8192-token
// context limit of text-embedding-3-small. Articles are split at
// paragraph boundaries (~6000 tokens per chunk) and each chunk gets
// its own embedding row in sl_signpost_embeddings.
//
// One row per (article_id, chunk_index): semantic embedding of article body_text chunk,
// or title-only / title+excerpt for preview-only captures (always single-chunk).
//
// Retry per chunk: Attempt 1 → wait 2s → Attempt 2 → wait 8s → Attempt 3 → terminal.
// All-or-nothing: if any chunk fails, all chunks for the article are rolled back.
// Invocation: POST { article_id: uuid }
// =============================================================================

import { writeCaptureEvent }                   from '../_shared/capture_events.ts';
import {
  generateEmbedding,
  getEmbeddingModel,
  type EmbeddingResponse,
}                                               from '../_shared/embedding_client.ts';
import { mapEmbeddingHttpStatus,
         mapErrorToCode }                       from '../_shared/error_mapper.ts';
import { successResponse, errorResponse }       from '../_shared/response.ts';
import { getServiceClient }                     from '../_shared/supabase.ts';
import { chunkText, validateChunks }            from '../_shared/text_chunker.ts';

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

  // --- Check existing embeddings ---
  const { data: existingEmbs } = await supabase
    .from('sl_signpost_embeddings')
    .select('embedding_id')
    .eq('article_id', articleId)
    .eq('model_id', MODEL_ID());

  const hasExisting = existingEmbs && existingEmbs.length > 0;

  if (hasExisting && article.embedding_status === 'complete') {
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
  } else if (article.embedding_status === 'complete' && !hasExisting) {
    console.warn('[sl_embed_article] embedding_status complete but missing E8 row(s) — rebuilding', {
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

  // --- Chunk the text ---
  const chunks = chunkText(embedText);
  const totalChunks = chunks.length;
  const { valid, violations } = validateChunks(chunks);

  if (!valid) {
    const errMsg = `Chunking produced oversized segments at indices: ${violations.join(', ')}`;
    console.error('[sl_embed_article] chunking violation', { articleId, violations });
    await writeCaptureEvent({
      provider_id: article.provider_id,
      article_id:  articleId,
      event_type:  'embedding_failed',
      error_code:  'CHUNKING_ERROR',
      metadata:    { message: errMsg, chunk_count: totalChunks, violations },
    });
    return errorResponse(
      {
        error_code: 'CHUNKING_ERROR',
        message:    errMsg,
        retryable:  true,
        event_id:   null,
      },
      422,
    );
  }

  // --- Mark as processing ---
  await supabase
    .from('sl_articles')
    .update({ embedding_status: 'processing' })
    .eq('article_id', articleId);

  // --- Delete existing embeddings for this article (retry-safe) ---
  if (hasExisting) {
    const { error: delErr } = await supabase
      .from('sl_signpost_embeddings')
      .delete()
      .eq('article_id', articleId)
      .eq('model_id', MODEL_ID());

    if (delErr) {
      console.error('[sl_embed_article] failed to clear existing embeddings', { articleId, delErr });
      await supabase
        .from('sl_articles')
        .update({ embedding_status: 'failed' })
        .eq('article_id', articleId);
      return errorResponse(
        {
          error_code: 'TRANSIENT_DB_ERROR',
          message:    `Failed to clear existing embeddings: ${delErr.message}`,
          retryable:  true,
          event_id:   null,
        },
        503,
      );
    }
  }

  // --- Embed each chunk ---
  const embeddedRows: Array<{
    article_id:   string;
    model_id:     string;
    embedding:    string;
    chunk_index:  number;
    chunk_text:   string;
    total_chunks: number;
    provenance:   Record<string, unknown>;
  }> = [];

  let lastFailEventId: string | null = null;

  for (const chunk of chunks) {
    let lastResult: EmbeddingResponse | null = null;
    let chunkSuccess = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS[attempt - 1]));
      }

      lastResult = await generateEmbedding(chunk.text, apiKey);

      if (lastResult.success) {
        embeddedRows.push({
          article_id:   articleId,
          model_id:     MODEL_ID(),
          embedding:    vectorToPgString(lastResult.embedding),
          chunk_index:  chunk.chunk_index,
          chunk_text:   chunk.text,
          total_chunks: totalChunks,
          provenance: {
            model_version:     lastResult.model,
            input_token_count: lastResult.usage.prompt_tokens,
            total_tokens:      lastResult.usage.total_tokens,
            chunk_index:       chunk.chunk_index,
            total_chunks:      totalChunks,
            estimated_tokens:  chunk.estimated_tokens,
          },
        });
        chunkSuccess = true;
        break;
      }

      // --- Handle failure ---
      const mapped = mapEmbeddingHttpStatus(lastResult.httpStatus);

      const failEventId = await writeCaptureEvent({
        provider_id: article.provider_id,
        article_id:  articleId,
        event_type:  'embedding_failed',
        error_code:  mapped.error_code,
        metadata:    {
          attempt,
          httpStatus:   lastResult.httpStatus,
          message:      lastResult.message.slice(0, 2_048),
          chunk_index:  chunk.chunk_index,
          total_chunks: totalChunks,
        },
      });

      lastFailEventId = failEventId;

      if (!mapped.retryable) {
        break; // non-retryable — stop retrying this chunk
      }

      if (attempt < MAX_ATTEMPTS && failEventId) {
        await writeCaptureEvent({
          provider_id:       article.provider_id,
          article_id:        articleId,
          event_type:        'retry_attempted',
          retry_of_event_id: failEventId,
          metadata:          {
            next_wait_ms: RETRY_WAIT_MS[attempt],
            chunk_index:  chunk.chunk_index,
          },
        });
      }
    }

    if (!chunkSuccess) {
      // --- Chunk failed after all retries — mark failed and bail ---
      console.error('[sl_embed_article] chunk failed permanently', {
        articleId,
        chunk_index:      chunk.chunk_index,
        total_chunks:     totalChunks,
        chunks_completed: embeddedRows.length,
      });

      await supabase
        .from('sl_articles')
        .update({ embedding_status: 'failed' })
        .eq('article_id', articleId);

      const retryable = lastResult ? mapEmbeddingHttpStatus(lastResult.httpStatus).retryable : false;

      return errorResponse(
        {
          error_code: 'EMBEDDING_FAILURE',
          message:    `Embedding failed at chunk ${chunk.chunk_index + 1}/${totalChunks}: ${lastResult?.message ?? 'unknown error'}`,
          retryable,
          event_id:   lastFailEventId,
        },
        502,
      );
    }
  }

  // --- Insert all embedding rows ---
  const { error: embErr } = await supabase
    .from('sl_signpost_embeddings')
    .insert(embeddedRows);

  if (embErr) {
    const mapped = mapErrorToCode(embErr);
    console.error('[sl_embed_article] failed to insert embedding rows', {
      articleId,
      chunks: embeddedRows.length,
      error:  embErr,
    });

    await writeCaptureEvent({
      provider_id: article.provider_id,
      article_id:  articleId,
      event_type:  'embedding_failed',
      error_code:  mapped.error_code,
      metadata:    {
        phase:       'e8_write',
        chunk_count: embeddedRows.length,
        constraint:  mapped.constraint,
      },
    });

    await supabase
      .from('sl_articles')
      .update({ embedding_status: 'failed' })
      .eq('article_id', articleId);

    return errorResponse(
      {
        error_code: mapped.error_code,
        message:    `Failed to persist ${embeddedRows.length} embedding row(s): ${embErr.message}`,
        retryable:  mapped.retryable,
        event_id:   null,
      },
      mapped.error_code === 'TRANSIENT_DB_ERROR' ? 503 : 422,
    );
  }

  // --- Mark article as complete ---
  const { error: stErr } = await supabase
    .from('sl_articles')
    .update({ embedding_status: 'complete' })
    .eq('article_id', articleId);

  if (stErr) {
    console.error('[sl_embed_article] failed to mark article complete', { articleId, stErr });
  }

  // --- Success capture event ---
  const totalTokens = embeddedRows.reduce(
    (sum, r) => sum + ((r.provenance.total_tokens as number) ?? 0),
    0,
  );

  const successEventId = await writeCaptureEvent({
    provider_id: article.provider_id,
    article_id:  articleId,
    event_type:  'embedding_succeeded',
    metadata:    {
      model_id:           MODEL_ID(),
      total_chunks:       totalChunks,
      total_tokens:       totalTokens,
      chunk_token_counts: embeddedRows.map(r => r.provenance.input_token_count),
    },
  });

  return successResponse({
    article_id:       articleId,
    embedding_status: 'complete',
    status:           'success',
    chunks:           totalChunks,
    total_tokens:     totalTokens,
    event_id:         successEventId,
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
