# ADR-016: Evaluation Table Architecture

**Status:** Accepted  
**Date:** 2026-05-09  
**Set:** D — Operational-Reality  
**Source:** v1 Completion Plan team review (Gee proposed evaluation table schema; Copi added evaluation_type, content_hash, evaluated_content_hash; Grok added last_scraped and evaluation rubric requirement). OB entry 12eaaf92.

## Context

The v1 Completion Plan requires an evaluation workflow where Claude can assess prompt kits against Jonathan's current work and score them. A decision is needed on whether evaluation data should be stored as fields on `sl_articles` or in a dedicated table, and what additional fields are needed for drift detection and classification.

## Decision

Create a dedicated `sl_kit_evaluations` table for immutable evaluation history. Add supporting fields to `sl_articles` for status tracking, content integrity, and freshness.

### New table: `sl_kit_evaluations`

```sql
CREATE TABLE sl_kit_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES sl_articles(id),
  evaluator text NOT NULL,
  evaluation_type text NOT NULL DEFAULT 'fit-to-current-work'
    CHECK (evaluation_type IN (
      'fit-to-current-work',
      'periodic-review',
      'triggered-evaluation',
      'experimental-run',
      'deprecated'
    )),
  score numeric,
  notes text,
  evaluated_content_hash text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kit_eval_article ON sl_kit_evaluations(article_id);
CREATE INDEX idx_kit_eval_type ON sl_kit_evaluations(evaluation_type);
```

### New columns on `sl_articles`:

```sql
ALTER TABLE sl_articles
ADD COLUMN evaluation_status text NOT NULL DEFAULT 'unevaluated'
  CHECK (evaluation_status IN ('unevaluated', 'evaluated')),
ADD COLUMN content_hash text,
ADD COLUMN last_scraped timestamptz;
```

### Field rationale:

- **`evaluation_status`** on `sl_articles`: Denormalized convenience column for fast filtering. Updated transactionally when an evaluation is inserted. Not the source of truth — `sl_kit_evaluations` is.
- **`evaluation_type`** on `sl_kit_evaluations` (Copi): Classification of why the evaluation was performed. Enables filtering by evaluation context and supports future workflow automation.
- **`content_hash`** on `sl_articles` (Copi): SHA-256 hash of `body_text` at ingestion time. Enables drift detection — if content changes on re-scrape, the hash changes.
- **`evaluated_content_hash`** on `sl_kit_evaluations` (Copi): SHA-256 hash of `body_text` at evaluation time. If `content_hash != evaluated_content_hash` after a re-scrape, the evaluation is stale. Enables re-evaluation workflow in v1.1 without schema changes.
- **`last_scraped`** on `sl_articles` (Grok): Timestamp of most recent scrape. Enables freshness tracking for prompt kits that may evolve over time. Distinct from `published_at` (when the author published) and `created_at` (when Signal Ledger ingested).
- **`evaluator`**: Who performed the evaluation (e.g., `'claude'`, `'jonathan'`). Supports multi-evaluator scenarios.

### MCP tool:

`sl_mark_prompt_kit_evaluated(article_id, score, notes, evaluator?, evaluation_type?)`
- Validates `content_type = 'prompt_kit'` on the target article
- Reads current `content_hash` from `sl_articles` and writes it as `evaluated_content_hash`
- Inserts immutable evaluation record into `sl_kit_evaluations`
- Updates `sl_articles.evaluation_status = 'evaluated'`
- Both operations in one transaction
- Evaluation rubric must be documented in tool description so scores are consistent (Grok)

### Governance:

- `sl_kit_evaluations` is **append-only**. No UPDATE, no DELETE. Consistent with `sl_capture_events` discipline (ADR-002).
- Evaluations are events, not attributes. They have their own lifecycle independent of the article lifecycle.
- Multiple evaluations per article are expected and encouraged (different evaluation_types, re-evaluations over time).

## Alternatives Considered

**Fields on `sl_articles` only.** Rejected (unanimous team agreement). Collapses history, encourages mutation, breaks auditability, violates append-only governance posture.

**`evaluation_status` with enumerated values (unevaluated / evaluated / useful / not-useful).** Rejected in favor of simpler binary status on `sl_articles` with the richer classification in `sl_kit_evaluations.evaluation_type` and `score`. The article-level status answers "has this been evaluated?" — the evaluation record answers "how was it evaluated and what was the result?"

## Consequences

- Data Dictionary requires update (v0.5): new entity `sl_kit_evaluations`, new columns on `sl_articles`
- Functional Spec requires update: evaluation transaction boundary, tool validation rules
- New MCP tool `sl_mark_prompt_kit_evaluated` added to tool signatures
- New MCP tool `sl_list_unevaluated` added to tool signatures (query `sl_articles WHERE content_type = 'prompt_kit' AND evaluation_status = 'unevaluated'`)
- Enables v1.1 features without schema changes: re-evaluation workflow (compare content_hash vs evaluated_content_hash), staleness detection, evaluation history analysis

## Backward-Flow Check (per G4)

- **Data Dictionary:** Update required (v0.5). New entity, new columns. Triggered.
- **Functional Spec:** Update required. New transaction boundary for evaluation writes. Triggered.
- **Definition of Done:** May need addendum for evaluation acceptance criteria. Review after DD/FS updates.
- **All other upstream artifacts:** No correction needed.

## Deferred to v1.1 (per team review)

- Re-evaluation workflow / staleness flag (Copi — `content_hash` comparison enables this without schema changes)
- Stats/health tool showing total articles, prompt kits, evaluated count (Grok)
- Governance rules for Claude's use of kits in reasoning chains (Copi — system prompt guidance, not schema)
