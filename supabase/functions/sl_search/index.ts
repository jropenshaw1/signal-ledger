// =============================================================================
// Signal Ledger — sl_search Edge Function
// MCP tool: sl_search (WS-1 retrieval tools)
//
// Semantic search over the Signal Ledger corpus via pgvector cosine similarity.
// Generates an embedding for the query text, calls the sl_vector_search RPC,
// and returns ranked article-level results with best-chunk scores.
//
// ADR-014: queries match against per-chunk embeddings, deduplicated to
// best chunk per article via ROW_NUMBER in the RPC.
//
// Invocation: POST { query: string, filters?: object, limit?: number }
// =============================================================================

import { generateEmbedding } from '../_shared/embedding_client.ts';
import { getServiceClient }  from '../_shared/supabase.ts';

/** Same wire format as sl_embed_article → sl_signpost_embeddings.embedding (Postgres pgvector). */
function vectorToPgString(v: number[]): string {
  return JSON.stringify(v);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------------------------------------------------------------------------
// Input types & validation
// ---------------------------------------------------------------------------

interface SearchFilters {
  content_type?: string;
  provider_id?:  string;
  date_from?:    string;
  date_to?:      string;
}

interface SearchInput {
  query:    string;
  filters?: SearchFilters;
  limit?:   number;
}

function validateInput(body: unknown): { valid: boolean; input?: SearchInput; errors: string[] } {
  const errors: string[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const raw = body as Record<string, unknown>;

  if (!raw.query || typeof raw.query !== 'string' || raw.query.trim().length === 0) {
    errors.push('query is required (non-empty string)');
  }

  let limit = 5;
  if (raw.limit !== undefined) {
    limit = Number(raw.limit);
    if (isNaN(limit) || limit < 1 || limit > 20) {
      errors.push('limit must be between 1 and 20');
    }
  }

  if (raw.filters !== undefined && (typeof raw.filters !== 'object' || Array.isArray(raw.filters))) {
    errors.push('filters must be a JSON object');
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    input: {
      query:   (raw.query as string).trim(),
      filters: (raw.filters as SearchFilters) ?? undefined,
      limit:   Math.min(Math.max(Math.floor(limit), 1), 20),
    },
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

interface ArticleResult {
  article_id:          string;
  title:               string;
  published_date:      string;
  content_type:        string;
  provider_id:         string;
  provider_name:       string | null;
  capture_completeness: string;
  best_chunk_text:     string | null;
  best_chunk_index:    number;
  score:               number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const body = await req.json();
    const validation = validateInput(body);

    if (!validation.valid || !validation.input) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: validation.errors.join('; ') } }),
        { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const { query, filters, limit } = validation.input;

    // Step 1: Generate embedding for search query
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'SYSTEM_ERROR', message: 'OPENAI_API_KEY not configured' } }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const embeddingResult = await generateEmbedding(query, apiKey);
    if (!embeddingResult.success) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'EMBEDDING_FAILURE', message: embeddingResult.message } }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // Step 2: Call sl_vector_search RPC
    const client = getServiceClient();
    const embeddingStr = vectorToPgString(embeddingResult.embedding);

    const { data: rpcData, error: rpcError } = await client.rpc('sl_vector_search', {
      query_embedding:     embeddingStr,
      result_limit:        limit,
      filter_content_type: filters?.content_type ?? null,
      filter_provider_id:  filters?.provider_id ?? null,
      filter_date_from:    filters?.date_from ?? null,
      filter_date_to:      filters?.date_to ?? null,
    });

    if (rpcError) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'SYSTEM_ERROR', message: `Search failed: ${rpcError.message}` } }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // Step 3: Format results
    const results: ArticleResult[] = ((rpcData ?? []) as Record<string, unknown>[]).map((row) => ({
      article_id:          String(row.article_id),
      title:               String(row.title),
      published_date:      String(row.published_date),
      content_type:        String(row.content_type ?? 'article'),
      provider_id:         String(row.provider_id),
      provider_name:       row.provider_name ? String(row.provider_name) : null,
      capture_completeness: String(row.capture_completeness ?? 'complete'),
      best_chunk_text:     row.chunk_text ? String(row.chunk_text) : null,
      best_chunk_index:    Number(row.chunk_index ?? 0),
      score:               Number(row.similarity ?? 0),
    }));

    const output = {
      results,
      total_returned: results.length,
      query,
    };

    return new Response(
      JSON.stringify({ success: true, data: output, error: null }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'SYSTEM_ERROR', message: `Unexpected error: ${(err as Error).message}` } }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
