// =============================================================================
// Signal Ledger — capture event writer (Data Dictionary v0.3 § E7)
// Functional Spec v1.1 §3 — append-only audit trail (never UPDATE / DELETE).
//
// writeCaptureEvent() is fire-and-log. It NEVER throws. Capture-event write
// failures are logged but must not roll back primary operations.
//
// App-layer guards:
//   - retry_attempted requires non-null retry_of_event_id
//   - ingestion_failed / embedding_failed require non-null error_code
// =============================================================================

import { getServiceClient } from './supabase.ts';
import type { ErrorCode, EventType, WriteCaptureEventParams } from './types.ts';

function failureEventNeedsErrorCode(event_type: EventType): boolean {
  return event_type === 'ingestion_failed' || event_type === 'embedding_failed';
}

export async function writeCaptureEvent(
  params: WriteCaptureEventParams
): Promise<string | null> {
  if (
    params.event_type === 'retry_attempted' &&
    !params.retry_of_event_id
  ) {
    console.error('[capture_events] retry_attempted requires retry_of_event_id', {
      event_type:  params.event_type,
      provider_id: params.provider_id,
      article_id:  params.article_id,
    });
    return null;
  }

  if (failureEventNeedsErrorCode(params.event_type)) {
    const code = params.error_code ?? null;
    if (!code) {
      console.error('[capture_events] ingestion_failed/embedding_failed requires error_code', {
        event_type:  params.event_type,
        provider_id: params.provider_id,
        article_id:  params.article_id,
      });
      return null;
    }
  } else if (params.error_code) {
    console.error('[capture_events] success-class event must omit error_code', {
      event_type:   params.event_type,
      provider_id:  params.provider_id,
      error_code:   params.error_code,
    });
    return null;
  }

  const supabase = getServiceClient();

  const row: {
    provider_id:         string;
    article_id:          string | null;
    event_type:          EventType;
    error_code:          ErrorCode | null;
    retry_of_event_id:   string | null;
    duration_ms:         number | null;
    metadata:            Record<string, unknown> | null;
  } = {
    provider_id:       params.provider_id,
    article_id:        params.article_id ?? null,
    event_type:        params.event_type,
    error_code:        params.error_code ?? null,
    retry_of_event_id: params.retry_of_event_id ?? null,
    duration_ms:       params.duration_ms ?? null,
    metadata:          params.metadata ?? null,
  };

  console.info('[capture_events] writing event', {
    event_type:  params.event_type,
    provider_id: params.provider_id,
    article_id:  params.article_id,
  });

  const { data, error } = await supabase
    .from('sl_capture_events')
    .insert(row)
    .select('event_id')
    .single();

  if (error) {
    console.error('[capture_events] write failed — event not recorded', {
      event_type:  params.event_type,
      provider_id: params.provider_id,
      article_id:  params.article_id,
      error,
    });
    return null;
  }

  const event_id = (data as { event_id: string } | null)?.event_id ?? null;
  console.info('[capture_events] event written', { event_id, event_type: params.event_type });
  return event_id;
}
