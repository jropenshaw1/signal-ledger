// =============================================================================
// Signal Ledger — gap window mutation logic
// Functional Spec v1.0 §7 — optimistic JSONB locking, no last-write-wins.
//
// Step 7: gap-window resolution with optimistic locking via updated_at.
//
// Gap windows live as a JSONB array on sl_provider_records.gap_windows.
// Each entry is identified by (gap_start, gap_end) — natural key.
// Mutations use a read-then-conditional-write pattern:
//   1. Read gap_windows + updated_at
//   2. Find matching entry
//   3. Mutate in application layer
//   4. Write back with WHERE updated_at = {read_value}
//   5. If 0 rows affected → conflict → surface to caller
//
// The updated_at trigger (trg_spr_updated_at) fires on any UPDATE,
// so a concurrent write between read and write will change updated_at,
// causing the WHERE clause to miss and returning 0 affected rows.
// =============================================================================

import { getServiceClient } from './supabase.ts';
import type {
  GapWindowEntry,
  GapResolutionStatus,
  GapTerminalStatus,
  GapResolutionPath,
} from './types.ts';

// ---------------------------------------------------------------------------
// Non-terminal statuses — gap windows in these states can be resolved.
// 'pending' is the V1 DDL value; 'open' and 'acknowledged' are Spec §7.
// ---------------------------------------------------------------------------
const NON_TERMINAL_STATUSES: Set<GapResolutionStatus> = new Set([
  'open',
  'pending',
  'acknowledged',
]);

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface GapResolveSuccess {
  success:    true;
  gapIndex:   number;
  previous:   GapWindowEntry;
  updated:    GapWindowEntry;
}

export interface GapResolveFailure {
  success:    false;
  reason:     'not_found' | 'already_terminal' | 'conflict' | 'db_error' | 'provider_not_found';
  message:    string;
}

export type GapResolveResult = GapResolveSuccess | GapResolveFailure;

// ---------------------------------------------------------------------------
// Pure functions (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Finds a gap window entry by (gap_start, gap_end) in a JSONB array.
 * Returns the 0-based index, or -1 if not found.
 */
export function findGapWindowIndex(
  gapWindows: GapWindowEntry[],
  gapStart:   string,
  gapEnd:     string,
): number {
  return gapWindows.findIndex(
    (gw) => gw.gap_start === gapStart && gw.gap_end === gapEnd
  );
}

/**
 * Validates that a gap window can transition to a terminal status.
 * Returns null on success, or an error message string on failure.
 */
export function validateGapTransition(
  entry:            GapWindowEntry,
  targetStatus:     GapTerminalStatus,
): string | null {
  if (!NON_TERMINAL_STATUSES.has(entry.resolution_status)) {
    return (
      `Gap window ${entry.gap_start}/${entry.gap_end} is already ` +
      `"${entry.resolution_status}" — cannot transition to "${targetStatus}".`
    );
  }
  return null;
}

/**
 * Produces a new gap window entry with the resolution applied.
 * Pure function — does not mutate the input.
 */
export function applyResolution(
  entry:            GapWindowEntry,
  resolutionStatus: GapTerminalStatus,
  resolutionPath:   GapResolutionPath,
  notes?:           string | null,
): GapWindowEntry {
  return {
    ...entry,
    resolution_status: resolutionStatus,
    resolution_path:   resolutionPath,
    resolution_notes:  notes ?? entry.resolution_notes ?? null,
    last_updated:      new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DB-bound function — optimistic JSONB mutation
// ---------------------------------------------------------------------------

/**
 * Resolves a gap window with optimistic locking.
 *
 * Steps:
 *   1. Read provider record (gap_windows + updated_at)
 *   2. Find the matching gap window by (gap_start, gap_end)
 *   3. Validate the transition is legal
 *   4. Apply the resolution
 *   5. Write the full gap_windows array back with WHERE updated_at = {read_value}
 *   6. If 0 rows affected → conflict → return failure
 *
 * Returns a GapResolveResult discriminated union.
 */
export async function resolveGapWindow(
  providerId:       string,
  gapStart:         string,
  gapEnd:           string,
  resolutionStatus: GapTerminalStatus,
  resolutionPath:   GapResolutionPath,
  notes?:           string | null,
): Promise<GapResolveResult> {
  const supabase = getServiceClient();

  // -----------------------------------------------------------------------
  // 1. Read current state
  // -----------------------------------------------------------------------
  const { data: providerData, error: fetchErr } = await supabase
    .from('sl_provider_records')
    .select('gap_windows, updated_at')
    .eq('provider_id', providerId)
    .single();

  if (fetchErr || !providerData) {
    return {
      success: false,
      reason:  'provider_not_found',
      message: `Provider ${providerId} not found.`,
    };
  }

  const record = providerData as {
    gap_windows: GapWindowEntry[];
    updated_at:  string;
  };

  const gapWindows  = record.gap_windows ?? [];
  const readVersion = record.updated_at;

  // -----------------------------------------------------------------------
  // 2. Find matching gap window
  // -----------------------------------------------------------------------
  const idx = findGapWindowIndex(gapWindows, gapStart, gapEnd);

  if (idx === -1) {
    return {
      success: false,
      reason:  'not_found',
      message: `No gap window found for ${gapStart} to ${gapEnd} on provider ${providerId}.`,
    };
  }

  const existing = gapWindows[idx];

  // -----------------------------------------------------------------------
  // 3. Validate transition
  // -----------------------------------------------------------------------
  const validationError = validateGapTransition(existing, resolutionStatus);
  if (validationError) {
    return {
      success: false,
      reason:  'already_terminal',
      message: validationError,
    };
  }

  // -----------------------------------------------------------------------
  // 4. Apply resolution (pure)
  // -----------------------------------------------------------------------
  const updated = applyResolution(existing, resolutionStatus, resolutionPath, notes);

  // -----------------------------------------------------------------------
  // 5. Write back with optimistic lock
  // Build a new array with the updated entry at the same index.
  // -----------------------------------------------------------------------
  const newGapWindows = [...gapWindows];
  newGapWindows[idx]  = updated;

  const { data: writeData, error: writeErr } = await supabase
    .from('sl_provider_records')
    .update({ gap_windows: newGapWindows })
    .eq('provider_id', providerId)
    .eq('updated_at', readVersion)       // optimistic lock
    .select('provider_id')
    .single();

  // -----------------------------------------------------------------------
  // 6. Check for conflict
  // If updated_at changed between read and write, .single() returns null
  // with a PGRST116 (no rows) error. That's our conflict signal.
  // -----------------------------------------------------------------------
  if (writeErr || !writeData) {
    // Distinguish "no rows matched" (conflict) from other errors.
    const isConflict =
      writeErr?.code === 'PGRST116' ||       // PostgREST: "no rows returned"
      writeErr?.details?.includes('0 rows');  // fallback heuristic

    if (isConflict || !writeErr) {
      return {
        success: false,
        reason:  'conflict',
        message:
          `Optimistic lock conflict on provider ${providerId}. ` +
          `The provider record was modified between read and write. ` +
          `Re-read and retry.`,
      };
    }

    return {
      success: false,
      reason:  'db_error',
      message: `Database error during gap window update: ${writeErr.message}`,
    };
  }

  return {
    success:  true,
    gapIndex: idx,
    previous: existing,
    updated:  updated,
  };
}
