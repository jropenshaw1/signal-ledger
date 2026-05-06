#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/**
 * Cursor-based article backfill: walk list pages until no next_cursor, ingesting each
 * article (idempotent via sl_ingest_article). Stops cleanly when per-minute / per-day
 * budget gates (DD v0.3) yield (FS v1.1 §10).
 *
 * Env: same as ingest_first_article, plus optional:
 *   EC_BACKFILL_MAX_ARTICLES — max ingest attempts this invocation (default 50)
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

function withCursor(baseUrl: string, cursor: string | null): string {
  const u = new URL(baseUrl);
  if (cursor !== null && cursor !== '') {
    u.searchParams.set(
      Deno.env.get('EC_LIST_CURSOR_QUERY')?.trim() ?? 'cursor',
      cursor,
    );
  }
  return u.toString();
}

(async () => {
  const baseList =
    Deno.env.get('EC_ARTICLES_LIST_URL')?.trim() ??
    Deno.env.get('EC_ARTICLES_ENDPOINT')?.trim();

  if (!baseList?.startsWith('https://')) {
    throw new Error(
      'Set EC_ARTICLES_LIST_URL (full HTTPS URL for first batch; cursor appended via EC_LIST_CURSOR_QUERY, default cursor=)',
    );
  }

  const token       = req('EC_MCP_ACCESS_TOKEN');
  const serviceKey  = req('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = envOr('SUPABASE_URL', DEFAULT_SUPABASE);
  const providerId  = envOr('SIGNAL_LEDGER_PROVIDER_ID', DEFAULT_PROVIDER);
  const budgetPath  = envOr('EC_BUDGET_STATE_PATH', 'data/ec_executive_circle_budget.json');
  const maxArticles = parseInt(Deno.env.get('EC_BACKFILL_MAX_ARTICLES') ?? '50', 10);

  const budget      = await ExecutiveCircleBudget.open(budgetPath);

  await Deno.mkdir('data', { recursive: true }).catch(() => undefined);

  let cursor: string | null = null;
  let totalAttempted       = 0;
  let totalIngested        = 0;
  let totalDuplicate       = 0;

  outer:
  while (totalAttempted < maxArticles) {
    const url = withCursor(baseList, cursor);

    const fetched = await ecGetJson({ url, bearerToken: token, budget });

    if (!fetched.ok && fetched.kind === 'budget') {
      console.warn('[ec-backfill] Yielding — budget (FS §10)', fetched.yield);
      console.warn('next_retry_eligible_at', fetched.yield.nextRetryEligibleAt);
      break outer;
    }

    if (!fetched.ok) {
      console.error('[ec-backfill] List HTTP error', fetched);
      Deno.exit(2);
    }

    const rows = extractArticlesArray(fetched.json);
    const next = extractNextCursor(fetched.json);

    if (rows.length === 0) {
      console.log('[ec-backfill] Empty page — done.');
      break;
    }

    for (const raw of rows) {
      if (totalAttempted >= maxArticles) break outer;

      const art = normalizeArticle(raw);
      if (!art) {
        continue;
      }

      totalAttempted++;

      const ing = await ingestArticleEmailBackfill({
        supabaseUrl,
        serviceRoleKey: serviceKey,
        providerId,
        article: art,
      });

      if (!ing.success) {
        console.warn('[ec-backfill] Ingest failed', art.stableId, ing.httpStatus, ing.error);
        continue;
      }

      if (ing.status === 'duplicate-detected') {
        totalDuplicate++;
      } else {
        totalIngested++;
      }

      console.log(`[ec-backfill] ${ing.status} ${art.stableId} → ${ing.article_id}`);
    }

    if (!next) {
      console.log('[ec-backfill] No next_cursor — list complete for this config.');
      break;
    }

    cursor = next;
  }

  console.log('');
  console.log('[ec-backfill] Summary', {
    totalAttempted,
    totalIngested,
    totalDuplicate,
    budget: budget.snapshot(),
  });
})().catch((e) => {
  console.error(e);
  Deno.exit(99);
});
