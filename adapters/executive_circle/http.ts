/**
 * HTTPS fetch helper — ADR-004 certificate validation unchanged (native fetch TLS).
 * ADR-003: bearer token from env only; never log token.
 */

import { ExecutiveCircleBudget, yieldFrom429 }       from './budget_store.ts';

export async function ecGetJson(args: {
  url:         string;
  bearerToken: string;
  budget:      ExecutiveCircleBudget;
}): Promise<
  | { ok: true; status: number; json: unknown }
  | { ok: false; kind: 'budget'; yield: import('./types.ts').RateLimitYield }
  | { ok: false; kind: 'http'; status: number; bodySnippet: string }
> {
  const gate = args.budget.peekGate();
  if (!gate.ok) {
    args.budget.recordBudgetYield(JSON.stringify(gate.yield.reason));
    await args.budget.persist();
    return { ok: false, kind: 'budget', yield: gate.yield };
  }

  let res: Response;

  try {
    res = await fetch(args.url, {
      redirect: 'follow',
      headers: {
        'Authorization': `Bearer ${args.bearerToken}`,
        'Accept':        'application/json',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok:          false,
      kind:       'http',
      status:     0,
      bodySnippet: `network_error: ${msg.slice(0, 500)}`,
    };
  }

  args.budget.recordCompletedRequest();
  await args.budget.persist();

  if (res.status === 429) {
    const ra  = res.headers.get('Retry-After');
    const sec = ra ? parseInt(ra, 10) : NaN;
    const y   = yieldFrom429(Number.isFinite(sec) ? sec : undefined);
    args.budget.recordBudgetYield('http_429');
    await args.budget.persist();
    return { ok: false, kind: 'budget', yield: y };
  }

  if (!res.ok) {
    const text = await res.text();
    return {
      ok:         false,
      kind:       'http',
      status:     res.status,
      bodySnippet: text.slice(0, 1_024),
    };
  }

  const json = await res.json().catch(() => null);

  return { ok: true, status: res.status, json };
}
