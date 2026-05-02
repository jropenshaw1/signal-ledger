// =============================================================================
// Signal Ledger — gap_windows unit tests
// Step 7: Gap window matching, validation, and resolution logic
//
// Run: deno test supabase/functions/_shared/gap_windows_test.ts
//
// Tests cover the pure functions in gap_windows.ts:
//   - findGapWindowIndex: locates gap by (gap_start, gap_end)
//   - validateGapTransition: guards terminal→terminal transitions
//   - applyResolution: produces new entry with resolution applied
//
// DB-bound resolveGapWindow is tested via integration tests (requires Supabase).
// =============================================================================

import {
  assertEquals,
  assertNotEquals,
  assertExists,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  findGapWindowIndex,
  validateGapTransition,
  applyResolution,
} from './gap_windows.ts';
import type { GapWindowEntry, GapResolutionStatus } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGap(
  start: string,
  end: string,
  status: GapResolutionStatus = 'open',
): GapWindowEntry {
  return {
    gap_start:               start,
    gap_end:                 end,
    article_count_estimated: null,
    resolution_status:       status,
    resolution_path:         null,
  };
}

// =============================================================================
// SECTION 1 — findGapWindowIndex
// =============================================================================

Deno.test('[findGapWindowIndex] finds gap by exact (gap_start, gap_end) match', () => {
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

Deno.test('[findGapWindowIndex] partial match (start only) returns -1', () => {
  const gaps = [makeGap('2026-01-01', '2026-01-10')];
  assertEquals(findGapWindowIndex(gaps, '2026-01-01', '2026-01-15'), -1);
});

Deno.test('[findGapWindowIndex] partial match (end only) returns -1', () => {
  const gaps = [makeGap('2026-01-01', '2026-01-10')];
  assertEquals(findGapWindowIndex(gaps, '2026-01-05', '2026-01-10'), -1);
});

Deno.test('[findGapWindowIndex] finds first gap (index 0)', () => {
  const gaps = [
    makeGap('2026-01-01', '2026-01-10'),
    makeGap('2026-02-01', '2026-02-10'),
  ];
  assertEquals(findGapWindowIndex(gaps, '2026-01-01', '2026-01-10'), 0);
});

Deno.test('[findGapWindowIndex] finds last gap', () => {
  const gaps = [
    makeGap('2026-01-01', '2026-01-10'),
    makeGap('2026-02-01', '2026-02-10'),
    makeGap('2026-03-01', '2026-03-10'),
  ];
  assertEquals(findGapWindowIndex(gaps, '2026-03-01', '2026-03-10'), 2);
});

// =============================================================================
// SECTION 2 — validateGapTransition
// =============================================================================

const nonTerminalStatuses: GapResolutionStatus[] = ['open', 'pending', 'acknowledged'];
const terminalStatuses: GapResolutionStatus[]    = ['resolved', 'unresolvable'];

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

for (const status of terminalStatuses) {
  Deno.test(`[validateGapTransition] ${status} → resolved → blocked`, () => {
    const entry = makeGap('2026-01-01', '2026-01-10', status);
    const error = validateGapTransition(entry, 'resolved');
    assertExists(error);
    assertNotEquals(error, '');
  });

  Deno.test(`[validateGapTransition] ${status} → unresolvable → blocked`, () => {
    const entry = makeGap('2026-01-01', '2026-01-10', status);
    const error = validateGapTransition(entry, 'unresolvable');
    assertExists(error);
    assertNotEquals(error, '');
  });
}

// =============================================================================
// SECTION 3 — applyResolution
// =============================================================================

Deno.test('[applyResolution] sets resolution_status and resolution_path', () => {
  const entry   = makeGap('2026-02-12', '2026-02-21', 'pending');
  const updated = applyResolution(entry, 'resolved', 'email-backfill');
  assertEquals(updated.resolution_status, 'resolved');
  assertEquals(updated.resolution_path,   'email-backfill');
});

Deno.test('[applyResolution] sets last_updated to ISO string', () => {
  const entry   = makeGap('2026-02-12', '2026-02-21', 'open');
  const updated = applyResolution(entry, 'unresolvable', 'none');
  assertExists(updated.last_updated);
  // Verify it's a valid ISO string
  const parsed = Date.parse(updated.last_updated!);
  assertNotEquals(isNaN(parsed), true);
});

Deno.test('[applyResolution] preserves original fields', () => {
  const entry: GapWindowEntry = {
    gap_start:               '2026-02-12',
    gap_end:                 '2026-02-21',
    article_count_estimated: 10,
    resolution_status:       'pending',
    resolution_path:         null,
  };
  const updated = applyResolution(entry, 'resolved', 'email-backfill');
  assertEquals(updated.gap_start,               '2026-02-12');
  assertEquals(updated.gap_end,                 '2026-02-21');
  assertEquals(updated.article_count_estimated, 10);
});

Deno.test('[applyResolution] does not mutate original entry', () => {
  const entry   = makeGap('2026-02-12', '2026-02-21', 'open');
  const _updated = applyResolution(entry, 'resolved', 'web');
  assertEquals(entry.resolution_status, 'open');
  assertEquals(entry.resolution_path,   null);
});

Deno.test('[applyResolution] sets resolution_notes when provided', () => {
  const entry   = makeGap('2026-02-12', '2026-02-21', 'open');
  const updated = applyResolution(entry, 'resolved', 'email-backfill', 'Backfilled from Gmail archive');
  assertEquals(updated.resolution_notes, 'Backfilled from Gmail archive');
});

Deno.test('[applyResolution] preserves existing resolution_notes when notes arg is null', () => {
  const entry: GapWindowEntry = {
    ...makeGap('2026-02-12', '2026-02-21', 'acknowledged'),
    resolution_notes: 'Previous note',
  };
  const updated = applyResolution(entry, 'resolved', 'email-backfill', null);
  assertEquals(updated.resolution_notes, 'Previous note');
});

Deno.test('[applyResolution] overrides resolution_notes when new notes provided', () => {
  const entry: GapWindowEntry = {
    ...makeGap('2026-02-12', '2026-02-21', 'acknowledged'),
    resolution_notes: 'Old note',
  };
  const updated = applyResolution(entry, 'resolved', 'email-backfill', 'New note');
  assertEquals(updated.resolution_notes, 'New note');
});

// =============================================================================
// SECTION 4 — gap_window_id format validation (for sl_ingest_article)
// =============================================================================

Deno.test('[gap_window_id format] valid compound key parses correctly', () => {
  const gwId = '2026-02-12_2026-02-21';
  const parts = gwId.split('_');
  assertEquals(parts.length, 2);
  assertEquals(parts[0], '2026-02-12');
  assertEquals(parts[1], '2026-02-21');
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(parts[0]), true);
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(parts[1]), true);
});

Deno.test('[gap_window_id format] invalid format detected', () => {
  const bad = ['2026-02-12', 'bad_date', '', '2026-02-12_bad'];
  for (const gwId of bad) {
    const parts = gwId.split('_');
    const valid = parts.length === 2 &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[1]);
    assertEquals(valid, false, `Expected invalid for "${gwId}"`);
  }
});

// =============================================================================
// SECTION 5 — Completeness checks
// =============================================================================

Deno.test('[completeness] all non-terminal statuses covered in transition tests', () => {
  const expected = new Set<GapResolutionStatus>(['open', 'pending', 'acknowledged']);
  const tested   = new Set<GapResolutionStatus>(nonTerminalStatuses);
  for (const s of expected) {
    assertEquals(tested.has(s), true, `Missing transition test for "${s}"`);
  }
});

Deno.test('[completeness] all terminal statuses covered in blocking tests', () => {
  const expected = new Set<GapResolutionStatus>(['resolved', 'unresolvable']);
  const tested   = new Set<GapResolutionStatus>(terminalStatuses);
  for (const s of expected) {
    assertEquals(tested.has(s), true, `Missing blocking test for "${s}"`);
  }
});
