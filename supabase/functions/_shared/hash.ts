// =============================================================================
// Signal Ledger — shared hash utilities
// Extracted from sl_ingest_article (Step 4) for reuse by the embedding worker.
// =============================================================================

/**
 * Normalizes text for stable hashing: trim, lowercase, collapse whitespace.
 */
export function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Returns the lowercase hex SHA-256 digest of a UTF-8 string.
 * Uses the Web Crypto API (available in Deno and modern browsers).
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
