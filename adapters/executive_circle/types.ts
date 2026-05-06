/**
 * Executive Circle MCP adapter — canonical shapes after normalization.
 * Source identifiers: DD v0.3 § Upstream Source Properties (`executive-circle-mcp`).
 */

/** Normalized article for ingestion (maps to sl_ingest_article email-backfill payload). */
export interface CanonicalExecutiveArticle {
  /** Stable upstream id (used in synthetic message_id: `exc:${stableId}`). */
  stableId: string;
  title: string;
  /** YYYY-MM-DD */
  publishedDate: string;
  /** Prefer markdown/plain; adapter may strip minimal HTML — never executes it. */
  bodyText: string;
  captureCompleteness: 'complete' | 'preview-only' | 'partial';
  /** Canonical article URL when the API exposes it (stored on sl_articles.url for web-era pipeline). */
  canonicalUrl?: string | null;
}

/** Raw list/detail responses vary by provider — normalized in parse.ts */

export interface RateLimitYield {
  yielded: true;
  reason: 'per_minute' | 'per_day' | 'http_429';
  /** ISO8601 — best-effort next time a call may succeed */
  nextRetryEligibleAt: string;
  metadata: Record<string, unknown>;
}
