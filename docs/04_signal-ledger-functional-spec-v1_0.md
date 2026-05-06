# Signal Ledger — Functional Spec v1.0

**Status:** Implementation-binding  
**Date:** 2026-05-01  
**Scope:** Execution semantics, failure handling, system contracts  
**Out of scope:** Schema changes, MCP contract changes (locked in prior session)

---

## 0. Framing

- No schema or contract changes unless a critical defect is discovered
- All decisions in this document govern execution behavior only: transactions, sequencing, error models
- This document is the implementation authority for v1

---

## 1. Transaction Boundaries

### Atomicity Model

**Stance: Staged commit. Eventual completeness.**

Article persistence and embedding generation operate in separate transaction scopes. Embedding failure never rolls back a valid article write.

| Operation | Transaction Scope | Failure Behavior |
|---|---|---|
| `sl_articles` write | Atomic, own transaction | Rollback → nothing persisted |
| `sl_capture_events` write | Immediately after article commit | Never blocks article write |
| `sl_signpost_embeddings` write | Deferred — post-commit async | Article marked `embedding_status = 'pending'`; retried independently |

### Capture Event Sequencing

- `ingestion_started` → written **before** article write attempt
- `ingestion_succeeded` or `ingestion_failed` → written **after** commit attempt resolves
- Both written regardless of outcome

### Consistency Declaration (preview)

> No partial truth at article level. Eventual completeness at embedding level.

---

## 2. Embedding Pipeline Sequencing

### Mode: Deferred

Embeddings are enqueued after article commit. Never inline. This decouples external API failure from article ingestion integrity.

### Status Field on `sl_articles`

`embedding_status` values:

| Value | Meaning |
|---|---|
| `pending` | Article committed; embedding not yet attempted |
| `processing` | Embedding attempt in progress |
| `complete` | Embedding written to `sl_signpost_embeddings` |
| `failed` | All 3 attempts exhausted; requires manual triage |

### Retry Model

- **Total attempts:** 3 — Attempt 1 → wait 2s → Attempt 2 → wait 8s → Attempt 3 → terminal
- **After attempt 3 fails:** `embedding_status = 'failed'`; `embedding_failed` event written; no further automatic retry

### Idempotency

- Unique constraint on `(article_id, model_id)` in `sl_signpost_embeddings`
- Duplicate embedding writes blocked at DB level
- Application layer checks before write; DB constraint is the backstop

### Model Lock

- Model: `text-embedding-3-small`
- Dimensions: 1536
- No model-version routing in v1
- Provenance metadata written on every embedding row

---

## 3. Capture Event Semantics

### Principles

- Append-only — no updates, no deletes, ever
- New row for every state transition
- `sl_articles` is operational truth; `sl_capture_events` is immutable audit trail

### Required Event Types

| Event | Trigger |
|---|---|
| `ingestion_started` | Before article write attempt |
| `ingestion_succeeded` | After article commit confirmed |
| `ingestion_failed` | After article write failure |
| `embedding_queued` | After article commit, before embedding attempt |
| `embedding_succeeded` | Embedding write confirmed |
| `embedding_failed` | Embedding attempt failed (written per attempt) |
| `retry_attempted` | Each retry; includes `retry_of_event_id` link |

### Ordering Guarantees

Best-effort via `created_at` + serial `event_id`. Strict per-article ordering not enforced at DB level.

### Source of Truth

| Layer | Role |
|---|---|
| `sl_articles` | Operational state — governs system behavior |
| `sl_capture_events` | Audit trail — timeline reconstruction only; not used to derive state |

### Traceability Requirement

Given only `sl_capture_events` and an `article_id`, a full ingestion timeline must be reconstructible. If it is not, the event schema is incomplete.

---

## 4. Error Response Shapes

### Standard Response Envelope

```json
{
  "success": false,
  "data": null,
  "error": {
    "error_code": "DUPLICATE_ARTICLE",
    "message": "Article already exists for provider + external_id",
    "retryable": false,
    "event_id": "uuid"
  }
}
```

Success shape:

```json
{
  "success": true,
  "data": {
    "article_id": "uuid",
    "event_id": "uuid"
  },
  "error": null
}
```

### Error Contract Table

| `error_code` | Condition | `retryable` |
|---|---|---|
| `DUPLICATE_ARTICLE` | Unique constraint on `(provider_id, external_id)` | `false` |
| `VALIDATION_ERROR` | Missing required fields, type violations | `false` |
| `SCHEMA_VIOLATION` | DB constraint violation (non-duplicate) | `false` |
| `EMBEDDING_FAILURE` | OpenAI API failure | `true` |
| `RATE_LIMITED` | Upstream rate limit hit | `true` |
| `TRANSIENT_DB_ERROR` | Deadlock, timeout | `true` |
| `SYSTEM_ERROR` | Unclassified internal error | `true` |

### Deterministic Mapping Rules

- `DUPLICATE_ARTICLE` is **never** `SYSTEM_ERROR`
- Every DB constraint violation maps to a specific `error_code`
- `retryable` field is required on every error response — no exceptions

---

## 5. Retry Logic & Idempotency

### Retryable Failures

- Network errors
- `EMBEDDING_FAILURE`
- `RATE_LIMITED`
- `TRANSIENT_DB_ERROR`

### Terminal Failures (no retry)

- `VALIDATION_ERROR`
- `SCHEMA_VIOLATION`
- `DUPLICATE_ARTICLE`
- All 3 attempts exhausted

### `retry_of_event_id` — Strict Chain

Each retry row references its immediate predecessor event. Chain is traceable back to `ingestion_started`. No loose references.

### Idempotency Key

- Key: `(provider_id, external_id)`
- Unique constraint enforced on `sl_articles`
- Application layer checks before write
- DB constraint is the authoritative backstop
- **Guarantee:** Zero duplicate articles, even under repeated retries

---

## 6. Supabase Client + RLS Posture

| Concern | v1 Decision |
|---|---|
| Edge functions | Service role key only |
| RLS | **Explicitly disabled** — not half-enforced, not undefined |
| Direct client access | None — all reads/writes via MCP tools and edge functions |
| Audit attribution | Every write carries `event_id` + `article_id` + `provider_id` |
| User-level attribution | Not implemented in v1 |

Half-RLS is worse than no RLS. This is a clean, documented bypass — not an oversight.

---

## 7. Gap Window Resolution Mechanics

### Purpose

Gap windows are awareness signals for manual triage. The system does not auto-close windows by article count. Publication cadence is loose (typically 5–10 articles/week, no documented guarantee). You own resolution.

### JSONB Entry Structure

```json
{
  "start_date": "ISO8601",
  "end_date": "ISO8601",
  "provider_id": "uuid",
  "status": "open | acknowledged | resolved | unresolvable",
  "resolution_notes": "free text — optional",
  "last_updated": "ISO8601"
}
```

### Lifecycle

| State | Trigger |
|---|---|
| `open` | Gap detected — expected articles not received within window |
| `acknowledged` | Manually marked — search in progress |
| `resolved` | Article found and manually submitted for capture |
| `unresolvable` | Searched; nothing found — window closed without fill |

### Update Model

- `jsonb_set` atomic mutation — no full overwrite
- **Optimistic locking:** `updated_at` checked at write time; if value differs from read → reject, surface conflict to caller
- Last-write-wins is explicitly **not** the model — silent overwrites of analytical state are prevented

---

## 8. Observability

### Minimum Log Fields (every event)

| Field | Notes |
|---|---|
| `event_id` | UUID, globally unique |
| `article_id` | UUID; null for pre-article failures |
| `provider_id` | UUID |
| `error_code` | Null on success |
| `timestamp` | ISO8601, UTC |
| `duration_ms` | Wall time for the operation |

### Metrics to Instrument from Day One

| Metric | Granularity |
|---|---|
| Ingestion success rate | Per provider |
| Embedding failure rate | Overall + per provider |
| Retry frequency | Per event type |
| Gap window open/close rate | Per provider |
| p95 ingestion latency | Overall |

### Traceability Test

Given only `sl_capture_events` and an `article_id`, a full ingestion timeline must be reconstructible without querying any other table. This is a hard requirement for the event schema.

---

## 9. Consistency Model Declaration

> **Signal Ledger v1 operates under strong consistency at the article level — single atomic transaction, immediate commit — with eventual consistency at the embedding level via a deferred async pipeline with 3 total attempts (Attempt 1 → wait 2s → Attempt 2 → wait 8s → Attempt 3 → terminal). The append-only capture event log is the immutable audit source of truth. Canonical tables govern operational state. Gap windows are manual-triage signals with no automated closure threshold.**

---

## Appendix A — Ingestion Sequence (Happy Path)

```
Caller
  │
  ├─► [1] MCP tool: sl_ingest_article
  │
  ├─► [2] Write event: ingestion_started
  │
  ├─► [3] BEGIN TRANSACTION
  │       INSERT sl_articles
  │   COMMIT
  │
  ├─► [4] Write event: ingestion_succeeded
  │
  ├─► [5] Write event: embedding_queued
  │       Set sl_articles.embedding_status = 'pending'
  │
  └─► [6] Async: embedding pipeline
            ├─ Call text-embedding-3-small API
            ├─ INSERT sl_signpost_embeddings
            ├─ Set sl_articles.embedding_status = 'complete'
            └─ Write event: embedding_succeeded
```

---

## Appendix B — Ingestion Sequence (Article Write Failure)

```
  ├─► [2] Write event: ingestion_started
  │
  ├─► [3] BEGIN TRANSACTION
  │       INSERT sl_articles → FAILS
  │   ROLLBACK
  │
  └─► [4] Write event: ingestion_failed
            error_code: [DUPLICATE_ARTICLE | VALIDATION_ERROR | SCHEMA_VIOLATION | TRANSIENT_DB_ERROR]
            retryable: [true | false]
```

---

## Appendix C — Embedding Retry Sequence (3 total attempts)

```
  Embedding pipeline
  │
  ├─► Attempt 1 → FAILS
  │     Write event: embedding_failed (attempt 1)
  │     Write event: retry_attempted (retry_of_event_id → attempt 1)
  │     Wait 2s
  │
  ├─► Attempt 2 → FAILS
  │     Write event: embedding_failed (attempt 2)
  │     Write event: retry_attempted (retry_of_event_id → attempt 2)
  │     Wait 8s
  │
  ├─► Attempt 3 → FAILS
  │     Write event: embedding_failed (attempt 3)
  │     Set sl_articles.embedding_status = 'failed'
  │     No further automatic retry
  │
  └─► [Manual triage required]
```

---

## Appendix D — Gap Window Resolution Flow

```
Ingestion pipeline detects gap
  │
  ├─► Write gap_window entry: status = 'open'
  │
  [Manual — you]
  ├─► Search for missing article
  │     Update status = 'acknowledged'
  │
  ├─► Found → submit for capture → status = 'resolved'
  └─► Not found → status = 'unresolvable'
```

---

## Appendix E — Implementation Sequence

Per Gee's sequencing recommendation:

1. Add/verify `embedding_status` lifecycle support
2. Implement `sl_ingest_article` happy path and article-write failure path
3. Implement deterministic error mapper
4. Implement idempotency enforcement on `(provider_id, external_id)`
5. Implement async embedding worker
6. Implement retry chain with `retry_of_event_id`
7. Implement gap-window optimistic JSONB mutation
8. Add observability fields + metrics
9. Run failure-path tests before happy-path polish

---

*Signal Ledger Functional Spec v1.0 — implementation-binding as of 2026-05-01*  
*Retry count corrected per Gee review: 3 total attempts, 2 waits (2s → 8s). 32s removed.*
