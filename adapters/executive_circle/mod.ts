/**
 * Executive Circle MCP — source adapter utilities (REST + budget + Signal Ledger ingest).
 */

export type { CanonicalExecutiveArticle, RateLimitYield } from './types.ts';

export {
  ExecutiveCircleBudget,
  saveState,
  loadState,
  yieldFrom429,
} from './budget_store.ts';

export type { BudgetStateFile, BudgetGateResult } from './budget_store.ts';

export { ecGetJson } from './http.ts';

export {
  extractArticlesArray,
  extractNextCursor,
  normalizeArticle,
  naiveStripHtml,
} from './parse.ts';

export { ingestArticleEmailBackfill } from './ingest_bridge.ts';
