// =============================================================================
// Signal Ledger — Supabase service-role client
// Service role only — RLS explicitly disabled (Functional Spec v1.0 §6).
// No direct client access. All reads/writes via MCP tools and edge functions.
// =============================================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

let _client: SupabaseClient | null = null;

/**
 * Returns the service-role Supabase client singleton.
 *
 * Key migration v2: The new sb_secret_* keys are opaque (not JWTs) and
 * cannot go in the Authorization header. We pass them via the `apikey`
 * header instead, and supply a placeholder to the constructor's key
 * parameter (supabase-js requires a non-empty string there).
 *
 * OB_SUPABASE_SECRET is the canonical env var, owned by OpenBrain.
 * All projects (Signal Ledger, AegisRelay, etc.) share this key.
 *
 * Falls back to SUPABASE_SERVICE_ROLE_KEY for local dev where
 * `supabase functions serve` injects the legacy JWT automatically.
 */
export function getServiceClient(): SupabaseClient {
  if (_client) return _client;

  const url = Deno.env.get('SUPABASE_URL');
  const customKey = Deno.env.get('OB_SUPABASE_SECRET');
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url) {
    throw new Error('[supabase] SUPABASE_URL not set.');
  }

  if (customKey) {
    // New path: opaque key via apikey header
    _client = createClient(url, customKey, {
      auth: {
        persistSession:   false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          apikey: customKey,
        },
      },
    });
  } else if (legacyKey) {
    // Legacy path: JWT-based key (local dev / supabase functions serve)
    _client = createClient(url, legacyKey, {
      auth: {
        persistSession:   false,
        autoRefreshToken: false,
      },
    });
  } else {
    throw new Error(
      '[supabase] Neither OB_SUPABASE_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set. ' +
      'Set OB_SUPABASE_SECRET via `supabase secrets set`.'
    );
  }

  return _client;
}
