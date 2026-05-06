// =============================================================================
// Signal Ledger — gap window mutation (Functional Spec v1.1 §7)
// Data Dictionary v0.3 — JSONB array on sl_provider_records; each entry uses
// start_date, end_date, status, last_updated (among other fields).
//
// Optimistic lock: sl_provider_records.updated_at (migration 20260505180100).
// =============================================================================

import { getServiceClient } from './supabase.ts';
import type {
  GapWindowEntry,
  GapTerminalStatus,
  GapResolutionPath,
  GapWindowLifecycleStatus,
} from './types.ts';

const NON_TERMINAL_STATUSES: Set<GapWindowLifecycleStatus> = new Set([
  'open',
  'acknowledged',
]);

export interface GapResolveSuccess {
  success:  true;
  gapIndex: number;
  previous: GapWindowEntry;
  updated:  GapWindowEntry;
}

export interface GapResolveFailure {
  success:  false;
  reason:   'not_found' | 'already_terminal' | 'conflict' | 'db_error' | 'provider_not_found';
  message:  string;
}

export type GapResolveResult = GapResolveSuccess | GapResolveFailure;

export function findGapWindowIndex(
  gapWindows: GapWindowEntry[],
  gapStart:   string,
  gapEnd:     string,
): number {
  return gapWindows.findIndex(
    (gw) => gw.start_date === gapStart && gw.end_date === gapEnd,
  );
}

export function validateGapTransition(
  entry:           GapWindowEntry,
  targetStatus: GapTerminalStatus,
): string | null {
  if (!NON_TERMINAL_STATUSES.has(entry.status)) {
    return (
      `Gap window ${entry.start_date}/${entry.end_date} is already ` +
      `"${entry.status}" — cannot transition to "${targetStatus}".`
    );
  }
  return null;
}

export function applyResolution(
  entry:               GapWindowEntry,
  terminalStatus:     GapTerminalStatus,
  resolutionPath:     GapResolutionPath,
  notes?:             string | null,
): GapWindowEntry {
  return {
    ...entry,
    status:             terminalStatus,
    resolution_path:    resolutionPath,
    resolution_notes:   notes ?? entry.resolution_notes ?? null,
    last_updated:       new Date().toISOString(),
  };
}

export async function resolveGapWindow(
  providerId:       string,
  gapStart:         string,
  gapEnd:           string,
  resolutionStatus: GapTerminalStatus,
  resolutionPath:   GapResolutionPath,
  notes?:           string | null,
): Promise<GapResolveResult> {
  const supabase = getServiceClient();

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

  const idx = findGapWindowIndex(gapWindows, gapStart, gapEnd);

  if (idx === -1) {
    return {
      success: false,
      reason:  'not_found',
      message:
        `No gap window found for ${gapStart} to ${gapEnd} on provider ${providerId}.`,
    };
  }

  const existing = gapWindows[idx];

  const validationError = validateGapTransition(existing, resolutionStatus);
  if (validationError) {
    return {
      success: false,
      reason:  'already_terminal',
      message: validationError,
    };
  }

  const updated = applyResolution(existing, resolutionStatus, resolutionPath, notes);

  const newGapWindows = [...gapWindows];
  newGapWindows[idx]  = updated;

  const { data: writeData, error: writeErr } = await supabase
    .from('sl_provider_records')
    .update({ gap_windows: newGapWindows })
    .eq('provider_id', providerId)
    .eq('updated_at', readVersion)
    .select('provider_id')
    .single();

  if (writeErr || !writeData) {
    const isConflict =
      writeErr?.code === 'PGRST116' ||
      writeErr?.details?.includes('0 rows');

    if (isConflict || !writeErr) {
      return {
        success: false,
        reason:  'conflict',
        message:
          `Optimistic lock conflict on provider ${providerId}. ` +
          `Re-read gap_windows and retry.`,
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
