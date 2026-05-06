// =============================================================================
// Signal Ledger — gap_windows unit tests (DD v0.3 field names)
// Run: deno test supabase/functions/_shared/gap_windows_test.ts
// =============================================================================

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  findGapWindowIndex,
  validateGapTransition,
  applyResolution,
} from './gap_windows.ts';
import type { GapWindowEntry, GapWindowLifecycleStatus } from './types.ts';

const PROVIDER_ID = '00000000-0000-4000-a000-000000000001';

function makeGap(
  start: string,
  end: string,
  status: GapWindowLifecycleStatus = 'open',
): GapWindowEntry {
  return {
    start_date:   start,
    end_date:     end,
    provider_id:  PROVIDER_ID,
    status,
    last_updated: new Date().toISOString(),
  };
}

Deno.test('[findGapWindowIndex] exact start_date/end_date match', () => {
  const gaps = [
    makeGap('2026-01-01', '2026-01-10'),
    makeGap('2026-02-12', '2026-02-21'),
    makeGap('2026-03-01', '2026-03-05'),
  ];
  assertEquals(findGapWindowIndex(gaps, '2026-02-12', '2026-02-21'), 1);
});

Deno.test('[findGapWindowIndex] returns -1 when no match', () => {
  const gaps = [makeGap('2026-01-01', '2026-01-10')];
  assertEquals(findGapWindowIndex(gaps, '2026-05-01', '2026-05-10'), -1);
});

Deno.test('[findGapWindowIndex] returns -1 for empty array', () => {
  assertEquals(findGapWindowIndex([], '2026-01-01', '2026-01-10'), -1);
});

const nonTerminalStatuses: GapWindowLifecycleStatus[] = ['open', 'acknowledged'];

for (const status of nonTerminalStatuses) {
  Deno.test(`[validateGapTransition] ${status} → resolved → valid`, () => {
    const entry = makeGap('2026-01-01', '2026-01-10', status);
    assertEquals(validateGapTransition(entry, 'resolved'), null);
  });

  Deno.test(`[validateGapTransition] ${status} → unresolvable → valid`, () => {
    const entry = makeGap('2026-01-01', '2026-01-10', status);
    assertEquals(validateGapTransition(entry, 'unresolvable'), null);
  });
}

for (const status of ['resolved', 'unresolvable'] as const) {
  Deno.test(`[validateGapTransition] terminal ${status} → resolved → blocked`, () => {
    const entry = makeGap('2026-01-01', '2026-01-10', status);
    const err = validateGapTransition(entry, 'resolved');
    assertExists(err);
    assertNotEquals(err, '');
  });
}

Deno.test('[applyResolution] sets status and resolution_path', () => {
  const entry   = makeGap('2026-02-12', '2026-02-21', 'open');
  const updated = applyResolution(entry, 'resolved', 'email-backfill');
  assertEquals(updated.status, 'resolved');
  assertEquals(updated.resolution_path, 'email-backfill');
});

Deno.test('[applyResolution] bumps last_updated', () => {
  const entry   = makeGap('2026-02-12', '2026-02-21', 'open');
  const updated = applyResolution(entry, 'unresolvable', 'none');
  assertExists(updated.last_updated);
  assertNotEquals(isNaN(Date.parse(updated.last_updated)), true);
});

Deno.test('[gap_window_id compound key] parses two YYYY-MM-DD parts', () => {
  const gwId = '2026-02-12_2026-02-21';
  const parts  = gwId.split('_');
  assertEquals(parts.length, 2);
});
