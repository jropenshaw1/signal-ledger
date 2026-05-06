/**
 * Loose JSON parsers for unknown Executive Circle MCP list/detail payloads.
 */

import type { CanonicalExecutiveArticle } from './types.ts';

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export function extractArticlesArray(j: unknown): unknown[] {
  if (Array.isArray(j)) return j;

  const o = asRecord(j);
  if (!o) return [];

  for (
    const key of ['items', 'articles', 'data', 'results', 'posts', 'records', 'content']
  ) {
    const v = o[key];
    if (Array.isArray(v)) return v;
  }

  const data = asRecord(o['data']);
  if (data && Array.isArray(data['items'])) return data['items'] as unknown[];

  return [];
}

/** Best-effort next page cursor — extend when API shape is known. */
export function extractNextCursor(j: unknown): string | null {
  const o = asRecord(j);
  if (!o) return null;

  for (
    const k of ['next_cursor', 'nextCursor', 'cursor', 'next_page_token', 'pageToken']
  ) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (v === null) return null;
  }

  const p = asRecord(o['pagination']) ?? asRecord(o['page']);
  if (p) {
    for (const k of ['next_cursor', 'cursor', 'next']) {
      const v = p[k];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
  }

  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** Minimal HTML stripping — ADR-006: stored string is never executed. */
export function naiveStripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a single article object — extend field paths when docs exist.
 */
export function normalizeArticle(raw: unknown): CanonicalExecutiveArticle | null {
  const o = asRecord(raw);
  if (!o) return null;

  const stableId =
    pickString(o, ['id', 'slug', 'article_id', 'post_id', 'external_id', 'canonical_id']) ??
    pickString(asRecord(o['meta']) ?? {}, ['id']);

  const title =
    pickString(o, ['title', 'subject', 'name']) ?? null;

  if (!stableId || !title) {
    return null;
  }

  const publishedDateRaw =
    pickString(o, [
      'published_date',
      'publishedDate',
      'date',
      'published_at',
      'publishedAt',
    ]);

  const publishedDate =
    publishedDateRaw?.slice(0, 10) ??
    (typeof o['unix_date'] === 'number'
      ? new Date((o['unix_date'] as number) * 1_000).toISOString().slice(0, 10)
      : null);

  if (!publishedDate || !/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) {
    return null;
  }

  let rawBody =
    pickString(o, ['body_markdown', 'markdown', 'body_text', 'text', 'content', 'html']) ??
    '';

  if (!rawBody && typeof o['body'] === 'object' && o['body']) {
    const b = asRecord(o['body']);
    rawBody = pickString(b ?? {}, ['text', 'markdown', 'html']) ?? '';
  }

  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(rawBody);
  const bodyText  = looksHtml ? naiveStripHtml(rawBody) : rawBody;

  if (!bodyText.trim()) {
    return null;
  }

  const url =
    pickString(o, ['url', 'canonical_url', 'link', 'permalink']) ?? null;

  return {
    stableId,
    title,
    publishedDate,
    bodyText: bodyText.trim(),
    captureCompleteness: 'complete',
    canonicalUrl:        url,
  };
}
