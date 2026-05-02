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
 * Deno isolates are typically cold-started per request, but the singleton
 * avoids redundant construction when warm. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase's
 * Edge Function runtime — no .env file required in production.
 */
export function getServiceClient(): SupabaseClient {
  if (_client) return _client;

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error(
      '[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. ' +
      'These are injected automatically in the Supabase Edge Function runtime. ' +
      'For local dev, use `supabase functions serve` which injects them.'
    );
  }

  _client = createClient(url, key, {
    auth: {
      persistSession:   false,
      autoRefreshToken: false,
    },
  });

  return _client;
}
