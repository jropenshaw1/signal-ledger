// =============================================================================
// Signal Ledger — capture event writer
// Functional Spec v1.0 §3 — append-only audit trail, never updated or deleted.
//
// writeCaptureEvent() is fire-and-log. It NEVER throws. Capture event write
// failures are logged but must not block or roll back article ingestion.
// The audit trail is best-effort at the write layer; the article commit
// is the safety-critical operation.
//
// Step 6: retry_of_event_id formal column + app-layer guard.
//   - retry_attempted event_type requires non-null retry_of_event_id
//   - Other event types accept it optionally (stage-agnostic lineage)
//   - Self-reference guard is enforced at DB level (ck_sce_retry_not_self)
// =============================================================================

import { getServiceClient } from './supabase.ts';
import type { WriteCaptureEventParams } from './types.ts';

/**
 * Appends a single capture event row to sl_capture_events.
 *
 * Returns the generated event_id on success, null on failure.
 * Never throws — callers treat null as "event not recorded" and continue.
 *
 * App-layer guard (Step 6): event_type = 'retry_attempted' requires
 * retry_of_event_id to be non-null. Violations are logged and the event
 * is NOT written — returning null signals "event not recorded" without
 * throwing, consistent with the fire-and-log contract.
 *
 * Observability note: every call logs event_type + provider_id + article_id.
 * Full structured observability fields (duration_ms per §8) are carried via
 * event_notes in Step 2 and promoted to top-level fields in Step 8.
 */
export async function writeCaptureEvent(
  params: WriteCaptureEventParams
): Promise<string | null> {
  // -------------------------------------------------------------------------
  // App-layer guard (Step 6): retry_attempted requires retry_of_event_id
  // -------------------------------------------------------------------------
  if (
    params.event_type === 'retry_attempted' &&
    !params.retry_of_event_id
  ) {
    console.error('[capture_events] app-layer guard: retry_attempted requires retry_of_event_id', {
      event_type:  params.event_type,
      provider_id: params.provider_id,
      article_id:  params.article_id,
    });
    return null;
  }

  const supabase = getServiceClient();

  const row = {
    provider_id:                     params.provider_id,
    article_id:                      params.article_id              ?? null,
    event_type:                      params.event_type,
    event_status:                    params.event_status,
    ingestion_source:                params.ingestion_source,
    attempted_url:                   params.attempted_url           ?? null,
    attempted_title:                 params.attempted_title         ?? null,
    attempted_published_date:        params.attempted_published_date ?? null,
    source_vs_system_classification: params.source_vs_system_classification,
    failure_category:                params.failure_category        ?? null,
    retry_count:                     params.retry_count             ?? 0,
    raw_error:                       params.raw_error               ?? null,
    event_notes:                     params.event_notes             ?? null,
    retry_of_event_id:               params.retry_of_event_id       ?? null,
  };

  console.info('[capture_events] writing event', {
    event_type:         params.event_type,
    event_status:       params.event_status,
    provider_id:        params.provider_id,
    article_id:         params.article_id,
    retry_of_event_id:  params.retry_of_event_id ?? null,
  });

  const { data, error } = await supabase
    .from('sl_capture_events')
    .insert(row)
    .select('event_id')
    .single();

  if (error) {
    console.error('[capture_events] write failed — event not recorded', {
      event_type:        params.event_type,
      provider_id:       params.provider_id,
      article_id:        params.article_id,
      retry_of_event_id: params.retry_of_event_id ?? null,
      error,
    });
    return null;
  }

  console.info('[capture_events] event written', {
    event_id:          (data as { event_id: string } | null)?.event_id,
    event_type:        params.event_type,
    retry_of_event_id: params.retry_of_event_id ?? null,
  });

  return (data as { event_id: string } | null)?.event_id ?? null;
}
