/**
 * Bridge to Signal Ledger Edge Function sl_ingest_article (email-backfill path).
 * Uses synthetic Message-ID `exc:${stableId}` so external_id = `email:exc:${stableId}` (see ingest deriveExternalId).
 */

import type { CanonicalExecutiveArticle } from './types.ts';

export interface IngestSuccess {
  success: true;
  article_id: string;
  event_id: string;
  status: string;
}

export interface IngestFailure {
  success: false;
  error: { error_code: string; message: string } | null;
  httpStatus: number;
  body: string;
}

export async function ingestArticleEmailBackfill(args: {
  supabaseUrl:     string;
  serviceRoleKey: string;
  providerId:      string;
  article:        CanonicalExecutiveArticle;
}): Promise<IngestSuccess | IngestFailure> {
  const messageId = `exc:${args.article.stableId.replace(/[\s<>]/g, '')}`;

  const payload = {
    provider_id:      args.providerId,
    ingestion_source: 'email-backfill',
    content_payload:  {
      title:                 args.article.title,
      published_date:        args.article.publishedDate,
      capture_completeness: args.article.captureCompleteness,
      body_text:            args.article.bodyText,
      message_id:           messageId,
    },
  };

  const res = await fetch(`${args.supabaseUrl}/functions/v1/sl_ingest_article`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization: `Bearer ${args.serviceRoleKey}`,
      apikey:        args.serviceRoleKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: {
    success?: boolean;
    data?: { article_id: string; event_id: string; status: string };
    error?: { error_code: string; message: string };
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return {
      success:    false,
      error:      null,
      httpStatus: res.status,
      body:       text.slice(0, 2_000),
    };
  }

  if (json.success && json.data) {
    return {
      success:    true,
      article_id: json.data.article_id,
      event_id:   json.data.event_id,
      status:     json.data.status,
    };
  }

  return {
    success:    false,
    error:      json.error ?? null,
    httpStatus: res.status,
    body:       text.slice(0, 2_000),
  };
}
