# Executive Circle MCP — source adapter (`executive-circle-mcp`)

Implements DD v0.3 upstream-source behaviors for Nate B. Jones content:

- **HTTPS** outbound only (ADR-004 — platform TLS; never disable verification).
- **Bearer token**: **`EC_MCP_ACCESS_TOKEN`** (ADR-003 — never commit).
- **Rate limits**: 120/min, 2,000/day — persisted in **`EC_BUDGET_STATE_PATH`** (default `data/ec_executive_circle_budget.json`) across CLI runs (FS v1.1 §5.3, §10).
- **Ingest**: **`sl_ingest_article`** with **`email-backfill`** and **`message_id: exc:<stableId>`** for idempotent **`external_id`** (§5).

## Configure REST endpoints

Paste the **HTTPS JSON** article-list URL from your subscriber MCP setup (**`EC_ARTICLES_LIST_URL`**). Landing subscriber URLs are often **not** the same as the REST list endpoint — use the documented REST paths.

Extend **`parse.ts`** field lists once you see real JSON shapes.

## Scripts

```bash
export SUPABASE_SERVICE_ROLE_KEY=...
export EC_MCP_ACCESS_TOKEN=...
export EC_ARTICLES_LIST_URL='https://...your-json-articles-list...'
deno run --allow-net --allow-read --allow-write --allow-env scripts/ec/ingest_first_article.ts
```

```bash
export EC_BACKFILL_MAX_ARTICLES=100
deno run --allow-net --allow-read --allow-write --allow-env scripts/ec/backfill.ts
```

Exit **`10`** on **`ingest_first_article`** means budget gate yielded — rerun later per **`next_retry_eligible_at`** in logs.
