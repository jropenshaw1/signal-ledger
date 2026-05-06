/**
 * Persistent per-source budget tracking (FS v1.1 §5.3, §10).
 * Executive Circle MCP: 120 req/min, 2,000 req/day (DD v0.3).
 */

import type { RateLimitYield } from './types.ts';

const SOURCE_ID = 'executive-circle-mcp';

export interface BudgetStateFile {
  version: 1;
  source_id: typeof SOURCE_ID;
  daily_utc: Record<string, number>;
  requests_in_last_minute: number[];
  last_yield?: { at: string; reason: string };
}

const LIMIT_PER_MIN = 120;
const LIMIT_PER_DAY = 2_000;
const WINDOW_MS = 60_000;

function defaultState(): BudgetStateFile {
  return {
    version:                 1,
    source_id:               SOURCE_ID,
    daily_utc:               {},
    requests_in_last_minute: [],
  };
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function pruneMinuteWindow(now: number, buf: number[]): number[] {
  const cutoff = now - WINDOW_MS;
  return buf.filter((t) => t > cutoff);
}

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : '.';
}

export async function loadState(path: string): Promise<BudgetStateFile> {
  try {
    const raw = await Deno.readTextFile(path);
    const j     = JSON.parse(raw) as BudgetStateFile;
    if (j.version !== 1 || j.source_id !== SOURCE_ID) {
      return defaultState();
    }
    return j;
  } catch {
    return defaultState();
  }
}

export async function saveState(path: string, s: BudgetStateFile): Promise<void> {
  await Deno.mkdir(dirOf(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(s, null, 2) + '\n');
}

export type BudgetGateResult =
  | { ok: true }
  | { ok: false; yield: RateLimitYield };

export class ExecutiveCircleBudget {
  constructor(
    readonly statePath: string,
    private state: BudgetStateFile,
  ) {}

  static async open(path: string): Promise<ExecutiveCircleBudget> {
    const s = await loadState(path);
    return new ExecutiveCircleBudget(path, s);
  }

  /** Check before an upstream call: prunes expired minute timestamps (does not increment counters). */
  peekGate(): BudgetGateResult {
    const now = Date.now();

    const ring = pruneMinuteWindow(now, this.state.requests_in_last_minute);
    this.state.requests_in_last_minute = ring;

    const day   = utcDayKey(new Date(now));
    const daily = this.state.daily_utc[day] ?? 0;

    if (daily >= LIMIT_PER_DAY) {
      return {
        ok: false,
        yield: {
          yielded:             true,
          reason:              'per_day',
          nextRetryEligibleAt: nextUtcMidnightIso(new Date(now)),
          metadata:            { day, daily_count: daily, limit_per_day: LIMIT_PER_DAY },
        },
      };
    }

    if (ring.length >= LIMIT_PER_MIN) {
      const oldest   = Math.min(...ring);
      const eligible = new Date(oldest + WINDOW_MS).toISOString();
      return {
        ok: false,
        yield: {
          yielded:             true,
          reason:              'per_minute',
          nextRetryEligibleAt: eligible,
          metadata:            { count_in_window: ring.length, limit_per_minute: LIMIT_PER_MIN },
        },
      };
    }

    return { ok: true };
  }

  /** After completing an upstream HTTP request (counts toward MCP budget). */
  recordCompletedRequest(now = Date.now()): void {
    const day = utcDayKey(new Date(now));
    const pruned = pruneMinuteWindow(now, this.state.requests_in_last_minute);
    pruned.push(now);
    this.state.requests_in_last_minute = pruned;
    this.state.daily_utc[day]         = (this.state.daily_utc[day] ?? 0) + 1;
  }

  recordBudgetYield(reason: string): void {
    this.state.last_yield = { at: new Date().toISOString(), reason };
  }

  async persist(): Promise<void> {
    await saveState(this.statePath, this.state);
  }

  snapshot(): BudgetStateFile {
    return structuredClone(this.state);
  }
}

function nextUtcMidnightIso(from: Date): string {
  const d = new Date(from.getTime());
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

export function yieldFrom429(retryAfterSec?: number): RateLimitYield {
  const sec = retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 60;
  return {
    yielded:             true,
    reason:              'http_429',
    nextRetryEligibleAt: new Date(Date.now() + sec * 1_000).toISOString(),
    metadata:            { retry_after_sec: sec },
  };
}
