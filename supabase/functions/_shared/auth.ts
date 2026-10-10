// =============================================================================
// Signal Ledger — inbound API key auth middleware
// Key migration plan v2 — replaces gateway JWT verification (--no-verify-jwt).
//
// Every edge function must call verifyApiKey(req) before processing.
// The caller sends the sb_secret_* key via the `apikey` header.
// The function compares it against OB_SUPABASE_SECRET.
// =============================================================================

/**
 * Verify that the request carries a valid `apikey` header matching
 * the OB_SUPABASE_SECRET environment variable.
 *
 * Returns `true` if authorised, `false` otherwise.
 */
export function verifyApiKey(req: Request): boolean {
  const apikey   = req.headers.get('apikey');
  const expected = Deno.env.get('OB_SUPABASE_SECRET');

  if (!expected) {
    throw new Error(
      '[auth] OB_SUPABASE_SECRET not set. ' +
      'Run: supabase secrets set OB_SUPABASE_SECRET="<sb_secret_key>"',
    );
  }

  if (!apikey) return false;

  // Constant-time-ish comparison to avoid timing attacks.
  // Deno doesn't expose crypto.timingSafeEqual on strings directly,
  // so we do a length check + byte-by-byte OR accumulator.
  if (apikey.length !== expected.length) return false;

  const a = new TextEncoder().encode(apikey);
  const b = new TextEncoder().encode(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Convenience: returns a 401 Response suitable for early-return
 * when verifyApiKey fails.
 */
export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      data:    null,
      error: {
        error_code: 'UNAUTHORIZED',
        message:    'Missing or invalid apikey header.',
        retryable:  false,
        event_id:   null,
      },
    }),
    {
      status:  401,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
