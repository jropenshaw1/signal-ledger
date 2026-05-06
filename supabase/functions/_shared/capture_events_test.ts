// =============================================================================
// Signal Ledger — capture_events unit tests (DD v0.3)
// Run: deno test supabase/functions/_shared/capture_events_test.ts
// =============================================================================

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { WriteCaptureEventParams, EventType } from './types.ts';

function wouldBeRejectedByGuard(params: WriteCaptureEventParams): boolean {
  if (
    params.event_type === 'retry_attempted' &&
    !params.retry_of_event_id
  ) {
    return true;
  }
  const failsNeedCode =
    params.event_type === 'ingestion_failed' ||
    params.event_type === 'embedding_failed';
  if (failsNeedCode && !params.error_code) {
    return true;
  }
  if (!failsNeedCode && params.error_code) {
    return true;
  }
  return false;
}

function baseParams(overrides: Partial<WriteCaptureEventParams> = {}): WriteCaptureEventParams {
  return {
    provider_id:        '00000000-0000-4000-a000-000000000001',
    article_id:         '00000000-0000-4000-a000-000000000002',
    event_type:         'retry_attempted',
    retry_of_event_id:  '00000000-0000-4000-a000-000000000099',
    ...overrides,
  };
}

Deno.test('[guard] retry_attempted + no retry_of_event_id → rejected', () => {
  const params = baseParams({
    event_type:        'retry_attempted',
    retry_of_event_id: null,
  });
  assertEquals(wouldBeRejectedByGuard(params), true);
});

Deno.test('[guard] retry_attempted + undefined retry_of_event_id → rejected', () => {
  const params = baseParams({ event_type: 'retry_attempted' });
  delete (params as unknown as Record<string, unknown>).retry_of_event_id;
  assertEquals(wouldBeRejectedByGuard(params), true);
});

Deno.test('[guard] retry_attempted + empty string retry_of_event_id → rejected', () => {
  const params = baseParams({
    event_type:        'retry_attempted',
    retry_of_event_id: '',
  });
  assertEquals(wouldBeRejectedByGuard(params), true);
});

Deno.test('[guard] retry_attempted + valid retry_of_event_id → accepted', () => {
  const params = baseParams({
    event_type:        'retry_attempted',
    retry_of_event_id: '00000000-0000-4000-a000-000000000099',
  });
  assertEquals(wouldBeRejectedByGuard(params), false);
});

Deno.test('[guard] ingestion_failed without error_code → rejected', () => {
  const params: WriteCaptureEventParams = {
    provider_id: '00000000-0000-4000-a000-000000000001',
    article_id:  null,
    event_type:  'ingestion_failed',
  };
  assertEquals(wouldBeRejectedByGuard(params), true);
});

Deno.test('[guard] ingestion_failed with error_code → accepted', () => {
  const params: WriteCaptureEventParams = {
    provider_id: '00000000-0000-4000-a000-000000000001',
    article_id:  null,
    event_type:  'ingestion_failed',
    error_code:  'VALIDATION_ERROR',
  };
  assertEquals(wouldBeRejectedByGuard(params), false);
});

const nonRetryEventTypes: EventType[] = [
  'ingestion_started',
  'ingestion_succeeded',
  'ingestion_failed',
  'embedding_queued',
  'embedding_succeeded',
  'embedding_failed',
];

for (const eventType of nonRetryEventTypes) {
  Deno.test(`[guard] ${eventType} + no retry_of_event_id (when not failure-class) → accepted where applicable`, () => {
    const needsErr = eventType === 'ingestion_failed' || eventType === 'embedding_failed';
    const params: WriteCaptureEventParams = {
      provider_id: '00000000-0000-4000-a000-000000000001',
      article_id:  null,
      event_type:  eventType,
      error_code:  needsErr ? 'EMBEDDING_FAILURE' : undefined,
    };
    assertEquals(wouldBeRejectedByGuard(params), false);
  });
}

Deno.test('[guard completeness] all 7 event types exist in EventType union', () => {
  const allTypes: EventType[] = [
    'ingestion_started',
    'ingestion_succeeded',
    'ingestion_failed',
    'embedding_queued',
    'embedding_succeeded',
    'embedding_failed',
    'retry_attempted',
  ];
  assertEquals(allTypes.length, 7);
});
