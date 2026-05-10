// =============================================================================
// Signal Ledger — sl_get_article Edge Function
// MCP tool: sl_get_article (WS-1 retrieval tools)
//
// Retrieves a single article by ID with full body_text and DD v0.3 / WS-1 fields.
// Column set matches deployed sl_articles (no metadata JSONB in v0.3).
//
// Invocation: POST { article_id: string }
// =============================================================================

import { getServiceClient } from '../_shared/supabase.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(body: unknown): { valid: boolean; article_id?: string; errors: string[] } {
  const errors: string[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const raw = body as Record<string, unknown>;

  if (!raw.article_id || typeof raw.article_id !== 'string') {
    errors.push('article_id is required (uuid string)');
  }

  // Basic UUID format check
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (raw.article_id && typeof raw.article_id === 'string' && !uuidPattern.test(raw.article_id)) {
    errors.push('article_id must be a valid UUID');
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, article_id: raw.article_id as string, errors: [] };
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

interface ArticleOutput {
  article_id:           string;
  title:                string;
  published_date:       string;
  content_type:         string;
  provider_id:          string;
  provider_name:        string | null;
  capture_completeness: string;
  embedding_status:     string;
  ingestion_source:     string;
  ingestion_date:       string;
  evaluation_status:    string;
  content_hash:         string | null;
  last_scraped:         string | null;
  body_text:            string | null;
  external_id:          string | null;
  url:                  string | null;
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

    if (!validation.valid || !validation.article_id) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: validation.errors.join('; ') } }),
        { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const client = getServiceClient();

    // Query sl_articles joined with sl_provider_records
    const { data: article, error: queryError } = await client
      .from('sl_articles')
      .select(`
        article_id,
        title,
        published_date,
        content_type,
        provider_id,
        capture_completeness,
        embedding_status,
        ingestion_source,
        ingestion_date,
        evaluation_status,
        content_hash,
        last_scraped,
        body_text,
        external_id,
        url,
        sl_provider_records ( provider_name )
      `)
      .eq('article_id', validation.article_id)
      .maybeSingle();

    if (queryError) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'SYSTEM_ERROR', message: `Query failed: ${queryError.message}` } }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    if (!article) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: `Article ${validation.article_id} not found` } }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // FK embed: PostgREST may return an object or a single-element array depending on relationship metadata.
    const providerRaw = article.sl_provider_records as unknown;
    const providerRow = Array.isArray(providerRaw) ? providerRaw[0] : providerRaw;
    const providerName =
      providerRow &&
      typeof providerRow === 'object' &&
      'provider_name' in providerRow &&
      (providerRow as { provider_name: unknown }).provider_name != null
        ? String((providerRow as { provider_name: unknown }).provider_name)
        : null;

    const output: ArticleOutput = {
      article_id:           String(article.article_id),
      title:                String(article.title),
      published_date:       String(article.published_date),
      content_type:         String(article.content_type ?? 'article'),
      provider_id:          String(article.provider_id),
      provider_name:        providerName,
      capture_completeness: String(article.capture_completeness ?? 'complete'),
      embedding_status:     String(article.embedding_status ?? 'pending'),
      ingestion_source:     String(article.ingestion_source ?? ''),
      ingestion_date:       String(article.ingestion_date ?? ''),
      evaluation_status:    String(article.evaluation_status ?? 'unevaluated'),
      content_hash:         article.content_hash ? String(article.content_hash) : null,
      last_scraped:         article.last_scraped ? String(article.last_scraped) : null,
      body_text:            article.body_text ? String(article.body_text) : null,
      external_id:          article.external_id ? String(article.external_id) : null,
      url:                  article.url ? String(article.url) : null,
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
