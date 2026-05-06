#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/**
 * Fetch one page from Executive Circle MCP (configured URL), ingest the first
 * normalized article via sl_ingest_article (email-backfill path).
 *
 * Required env:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   EC_MCP_ACCESS_TOKEN     — OAuth access token / bearer for subscriber API (never commit)
 *
 * Recommended:
 *   EC_ARTICLES_LIST_URL — full HTTPS URL returning JSON (article list). Copy REST endpoint from MCP subscriber docs — landing MCP subscriber URLs rarely expose REST JSON directly.
 *   SUPABASE_URL — default matches project hosting Signal Ledger Edge Functions
 *   SIGNAL_LEDGER_PROVIDER_ID — Nate record (default: milestone test UUID)
 *
 * Optional:
 *   EC_BUDGET_STATE_PATH — where to persist DD rate-limit counters (FS §10 persistence)
 */

import {
  ExecutiveCircleBudget,
  ecGetJson,
  extractArticlesArray,
  extractNextCursor,
  normalizeArticle,
} from '../../adapters/executive_circle/mod.ts';
import { ingestArticleEmailBackfill } from '../../adapters/executive_circle/ingest_bridge.ts';

const DEFAULT_SUPABASE = 'https://blreixaevpbmhbhyqgbq.supabase.co';
const DEFAULT_PROVIDER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function req(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function envOr(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() ?? fallback;
}

await Deno.mkdir('data', { recursive: true }).catch(() => undefined);

const listUrl =
  Deno.env.get('EC_ARTICLES_LIST_URL')?.trim() ??
  Deno.env.get('EC_ARTICLES_ENDPOINT')?.trim();

if (!listUrl?.startsWith('https://')) {
  console.error(
    'Set EC_ARTICLES_LIST_URL to the full HTTPS article-list JSON endpoint from the EC MCP subscriber docs.',
  );
  console.error(
    '(The subscriber MCP landing URL alone is rarely the REST list endpoint — consult your setup page for API paths.)',
  );
  Deno.exit(1);
}

const token       = req('EC_MCP_ACCESS_TOKEN');
const serviceKey  = req('SUPABASE_SERVICE_ROLE_KEY');
const supabaseUrl = envOr('SUPABASE_URL', DEFAULT_SUPABASE);
const providerId  = envOr('SIGNAL_LEDGER_PROVIDER_ID', DEFAULT_PROVIDER);
const budgetPath  = envOr('EC_BUDGET_STATE_PATH', 'data/ec_executive_circle_budget.json');

const budget = await ExecutiveCircleBudget.open(budgetPath);

console.log('[ec] Fetching article list:', listUrl.slice(0, 96) + '…');

const fetched = await ecGetJson({
  url:          listUrl,
  bearerToken:  token,
  budget,
});

if (!fetched.ok && fetched.kind === 'budget') {
  console.warn('[ec] Budget gate — yielding (FS v1.1 §10)', fetched.yield);
  Deno.exit(10);
}

if (!fetched.ok) {
  console.error('[ec] List HTTP failure', fetched);
  Deno.exit(2);
}

const rows   = extractArticlesArray(fetched.json);
const cursor = extractNextCursor(fetched.json);

console.log(`[ec] List returned ${rows.length} raw item(s); next_cursor=${cursor ?? 'none'}`);

let chosen = null;

for (const raw of rows) {
  const n = normalizeArticle(raw);
  if (n) {
    chosen = n;
    break;
  }
}

if (!chosen) {
  console.error('[ec] No article normalized — extend adapters/executive_circle/parse.ts field paths.');
  console.error('[ec] First row sample:', JSON.stringify(rows[0] ?? null)?.slice(0, 900));
  Deno.exit(3);
}

console.log('[ec] Ingesting:', chosen.stableId, chosen.title.slice(0, 60));

const ingest = await ingestArticleEmailBackfill({
  supabaseUrl,
  serviceRoleKey: serviceKey,
  providerId,
  article: chosen,
});

if (!ingest.success) {
  console.error('[ec] sl_ingest_article failed:', ingest.httpStatus, ingest.error, ingest.body);
  Deno.exit(4);
}

console.log('[ec] Ingest OK:', ingest.article_id, ingest.status);
console.log('    event_id:', ingest.event_id);
