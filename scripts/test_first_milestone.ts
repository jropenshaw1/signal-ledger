#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * First-milestone smoke test (local → Supabase):
 *
 * 1. Upsert a provider row for Nate B. Jones (fixed test UUID).
 * 2. POST sl_ingest_article (email-backfill) with a unique Message-ID.
 * 3. Assert sl_articles row + sl_capture_events trail (started → succeeded → embedding_queued).
 * 4. POST sl_embed_article with that article_id.
 * 5. Assert sl_signpost_embeddings row + sl_articles.embedding_status = complete.
 *
 * Required env:
 *   SUPABASE_SERVICE_ROLE_KEY — service role JWT (never commit).
 *
 * Optional:
 *   SUPABASE_URL — default https://blreixaevpbmhbhyqgbq.supabase.co
 *
 * sl_embed_article runs in Supabase; OPENAI_API_KEY must be set on the deployed
 * function in the Supabase dashboard (not required in this script's env).
 *
 * Run:
 *   deno run --allow-net --allow-env scripts/test_first_milestone.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_SUPABASE_URL = 'https://blreixaevpbmhbhyqgbq.supabase.co';

/** Stable test provider so re-runs target the same row (idempotent upsert). */
const MILESTONE_PROVIDER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

interface IngestArticleData {
  article_id:             string;
  event_id:               string;
  capture_completeness:   string;
  status:                 string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data:    T | null;
  error:   { error_code: string; message: string; event_id?: string | null } | null;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) {
    throw new Error(`${name} must be set in the environment`);
  }
  return v.trim();
}

async function main(): Promise<void> {
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl =
    Deno.env.get('SUPABASE_URL')?.trim() ?? DEFAULT_SUPABASE_URL;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('[1] Upserting sl_provider_records (Nate B. Jones)…');

  const { error: upsertErr } = await supabase.from('sl_provider_records').upsert(
    {
      provider_id:         MILESTONE_PROVIDER_ID,
      provider_name:       'Nate B. Jones',
      platform:            'Substack',
      publication_name:    'Nate Jones on …',
      publication_url:      'https://natekjones.substack.com',
      subscription_tier:   'paid',
      corpus_start_date:   '2026-02-12',
      gap_windows:         [],
    },
    { onConflict: 'provider_id' },
  );

  if (upsertErr) {
    throw new Error(`Provider upsert failed: ${upsertErr.message}`);
  }

  const messageId = `milestone-${Date.now()}@signal-ledger.test`;
  const published   = new Date().toISOString().slice(0, 10);
  const title       = `Signal Ledger milestone test — ${messageId}`;

  const ingestBody = {
    provider_id:      MILESTONE_PROVIDER_ID,
    ingestion_source: 'email-backfill',
    content_payload:  {
      title,
      published_date:        published,
      capture_completeness:  'complete',
      body_text:
        'This is synthetic body text for the first-milestone script. ' +
        'Trajectory-aware retrieval starts with a single honest row.',
      message_id: messageId,
    },
  };

  /** Events at/after this instant should include this run (clock skew buffer). */
  const windowStart = new Date(Date.now() - 2_000).toISOString();

  console.log('[2] POST sl_ingest_article…');

  const ingestRes = await fetch(
    `${supabaseUrl}/functions/v1/sl_ingest_article`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey:        serviceKey,
      },
      body: JSON.stringify(ingestBody),
    },
  );

  const ingestJson = (await ingestRes.json()) as ApiEnvelope<IngestArticleData>;

  assert(
    ingestJson.success && ingestJson.data,
    `Ingest failed: HTTP ${ingestRes.status} ${JSON.stringify(ingestJson)}`,
  );

  const articleId = ingestJson.data!.article_id;
  assertEquals(ingestJson.data!.status, 'success');

  console.log(`    article_id=${articleId}`);

  console.log('[3] Verifying sl_articles…');

  const { data: articleRow, error: artErr } = await supabase
    .from('sl_articles')
    .select(
      'article_id, provider_id, external_id, title, embedding_status, ingestion_source, capture_completeness',
    )
    .eq('article_id', articleId)
    .single();

  if (artErr || !articleRow) {
    throw new Error(`sl_articles read failed: ${artErr?.message ?? 'no row'}`);
  }

  assertEquals(articleRow.provider_id, MILESTONE_PROVIDER_ID);
  assertEquals(articleRow.ingestion_source, 'email-backfill');
  assertEquals(articleRow.capture_completeness, 'complete');
  assertEquals(articleRow.embedding_status, 'pending');
  assert(
    typeof articleRow.external_id === 'string' &&
      articleRow.external_id.startsWith('email:'),
    `expected external_id from message_id, got ${articleRow.external_id}`,
  );

  console.log('[3b] Verifying sl_capture_events trail…');

  const { data: eventsWindow, error: evErr } = await supabase
    .from('sl_capture_events')
    .select('event_type, article_id, error_code')
    .eq('provider_id', MILESTONE_PROVIDER_ID)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: true });

  if (evErr) {
    throw new Error(evErr.message);
  }

  const seq = eventsWindow ?? [];

  assert(
    seq.some(
      (e) => e.event_type === 'ingestion_started' && e.article_id === null && !e.error_code,
    ),
    `expected ingestion_started (article_id null): ${JSON.stringify(seq)}`,
  );

  assert(
    seq.some(
      (e) =>
        e.article_id === articleId &&
        e.event_type === 'ingestion_succeeded' &&
        !e.error_code,
    ),
    `expected ingestion_succeeded for article: ${JSON.stringify(seq)}`,
  );

  assert(
    seq.some(
      (e) =>
        e.article_id === articleId &&
        e.event_type === 'embedding_queued' &&
        !e.error_code,
    ),
    `expected embedding_queued for article: ${JSON.stringify(seq)}`,
  );

  const trail = seq
    .filter((e) => e.article_id === articleId || e.event_type === 'ingestion_started')
    .map((e) => (e.article_id === null ? `${e.event_type}(—)` : `${e.event_type}`))
    .join(' → ');

  console.log(`    ${trail}`);

  console.log('[4] POST sl_embed_article…');

  const embedRes = await fetch(`${supabaseUrl}/functions/v1/sl_embed_article`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization: `Bearer ${serviceKey}`,
      apikey:        serviceKey,
    },
    body: JSON.stringify({ article_id: articleId }),
  });

  const embedJson = (await embedRes.json()) as ApiEnvelope<{
    article_id: string;
    embedding_status: string;
    status: string;
  }>;

  assert(
    embedJson.success && embedJson.data?.embedding_status === 'complete',
    `Embed failed: HTTP ${embedRes.status} ${JSON.stringify(embedJson)}`,
  );

  console.log('[5] Verifying sl_articles.embedding_status + sl_signpost_embeddings…');

  const { data: afterArticle, error: afterArtErr } = await supabase
    .from('sl_articles')
    .select('embedding_status')
    .eq('article_id', articleId)
    .single();

  if (afterArtErr || !afterArticle) {
    throw new Error(afterArtErr?.message ?? 'article missing after embed');
  }

  assertEquals(afterArticle.embedding_status, 'complete');

  const { data: embRow, error: embErr } = await supabase
    .from('sl_signpost_embeddings')
    .select('embedding_id, article_id, model_id, provenance')
    .eq('article_id', articleId)
    .eq('model_id', 'text-embedding-3-small')
    .maybeSingle();

  if (embErr) {
    throw new Error(embErr.message);
  }

  assert(embRow !== null, 'expected one sl_signpost_embeddings row for article + model');
  assertEquals(embRow!.article_id, articleId);
  assert(typeof embRow!.provenance === 'object' && embRow!.provenance !== null);

  console.log('');
  console.log('All milestone checks passed.');
  console.log(`  Provider: ${MILESTONE_PROVIDER_ID}`);
  console.log(`  Article:  ${articleId}`);
  console.log(`  Message-ID used: ${messageId}`);
}

main().catch((e) => {
  console.error(e);
  Deno.exit(1);
});
