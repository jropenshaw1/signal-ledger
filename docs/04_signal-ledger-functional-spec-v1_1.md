# Signal Ledger — Functional Spec v1.1

**Status:** LOCKED — 2026-05-05
**Version:** v1.1
**Date:** 2026-05-05
**Scope:** Execution semantics, failure handling, system contracts (extends v1.0 with budget-aware multi-day backfill behavior)
**Out of scope:** Schema changes, MCP contract changes, mechanism prescription for budget governance (algorithm shape, persistence mechanism)
**Supersedes:** Functional Spec v1.0 (LOCKED 2026-05-01)
**Triggered By:** ADR-013 (rate-limit budget governance for upstream content sources)
**Tag:** [signal-ledger:functional-spec-v1.1]

---

## 0. Framing

- v1.1 extends v1.0 with budget-aware multi-day backfill behavior. No schema changes. No MCP contract changes. No new transaction boundaries. v1.0 content is preserved verbatim except where explicitly noted in the Changes-from-v1.0 table below.
- v1.1 specifies *behavioral contract* for budget governance. It does not prescribe algorithm shape (token-bucket vs. sliding-window vs. exponential-backoff-on-429) or persistence mechanism (table vs. JSONB vs. ledger pattern). Those are implementation territory. Per session 6 prep decision (2026-05-05): behavioral contract only, no implementer guidance.
- This document is the implementation authority for v1 budget-aware backfill behavior. ADR-013 records the architectural decision; this spec records the observable contract that adapter implementations must satisfy.
- All decisions in this document govern execution behavior only: transactions, sequencing, error models, budget envelope.

### Changes from v1.0

| Change | Section | Reason |
|---|---|---|
| Framing note added on v1.1 scope | § 0 | Mark v1.1 as additive extension |
| `RATE_LIMITED` row clarified to include budget-exhausted sub-case | § 4 | Existing error class extended to cover daily-budget exhaustion, not only per-request rate-limit responses |
| Sub-case clarification paragraph added below error contract table | § 4 | Distinguish per-request rate-limit response from budget-exhausted condition; both retryable, different resumption time profiles |
| § 5.3 Budget Envelope sub-section added | § 5 | Budget governance is a different problem from per-call retry; placed adjacent for reader continuity |
| New § 10 — Multi-Day Backfill Behavior | § 10 | Behavioral contract for budget-aware multi-day backfill per ADR-013 |
| § 8 metrics list extended with multi-day backfill aggregations | § 8 | Per-source budget consumption rate, budget-exhausted blocking events, multi-day backfill resumption events; observable from existing fields |

### Not changed in v1.1

- § 1 Transaction Boundaries — unchanged
- § 2 Embedding Pipeline Sequencing — unchanged. ADR-013 explicitly preserves § 2 retry caps. Embedding worker behavior is unaffected by adapter-layer budget governance.
- § 3 Capture Event Semantics — unchanged
- § 6 Supabase Client + RLS Posture — unchanged
- § 7 Gap Window Resolution Mechanics — unchanged
- § 9 Consistency Model Declaration — unchanged. Budget governance does not alter the article-level strong / embedding-level eventual posture.
- All v1.0 appendices (A through E) — unchanged

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
| `RATE_LIMITED` | Upstream rate limit hit — covers both per-request rate-limit response (e.g., HTTP 429) and per-source daily-budget exhaustion as observed by the source adapter | `true` |
| `TRANSIENT_DB_ERROR` | Deadlock, timeout | `true` |
| `SYSTEM_ERROR` | Unclassified internal error | `true` |

### Sub-case clarification: per-request vs. budget-exhausted

`RATE_LIMITED` covers two distinguishable conditions; both retryable, but with different resumption time profiles:

- **Per-request rate-limit response.** Source returned an explicit rate-limit signal (e.g., HTTP 429). Retryable on a short timescale (seconds to minutes). Existing v1.0 retry semantics apply.
- **Budget-exhausted.** Source-adapter detected the per-source daily budget envelope is consumed (e.g., 2,000 requests/day for Executive Circle MCP per DD v0.3 § Upstream Source Properties). Retryable on a longer timescale (until the budget window resets). Multi-day backfill behavior per § 10 governs this case.

Both surface as `error_code: RATE_LIMITED` with `retryable: true`. The distinction is preserved in `sl_capture_events.metadata` for observability; it is not promoted to a separate error code because both are the same logical class (upstream rate constraint) and treating them identically at the contract level keeps callers simple.

### Deterministic Mapping Rules

- `DUPLICATE_ARTICLE` is **never** `SYSTEM_ERROR`
- Every DB constraint violation maps to a specific `error_code`
- `retryable` field is required on every error response — no exceptions

---

## 5. Retry Logic & Idempotency

### 5.1 Retryable Failures

- Network errors
- `EMBEDDING_FAILURE`
- `RATE_LIMITED`
- `TRANSIENT_DB_ERROR`

### 5.2 Terminal Failures (no retry)

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

### 5.3 Budget Envelope (new in v1.1)

Per-call retry semantics in § 5.1 and § 5.2 address transient failures of individual upstream calls. The budget envelope addresses a structurally different problem: the source-level rate-limit envelope within which all calls must fit, regardless of whether any individual call succeeds or fails on first attempt.

**Relationship to per-call retry.**

- Per-call retry asks: *if this call failed, do I try it again, and how soon?*
- Budget envelope asks: *given my remaining budget, am I allowed to make any call right now — including a retry?*

Both apply to every upstream call. The budget envelope is the outer constraint; per-call retry is the inner one. A retry that would exceed the budget is suppressed regardless of its `retryable: true` classification.

**Behavioral contract for the budget envelope:**

- The source adapter MUST track outstanding budget consumption against the per-source rate limits documented in DD v0.3 § Upstream Source Properties.
- The source adapter MUST NOT issue an upstream call (initial attempt or retry) when issuing it would exceed any per-source budget envelope.
- When the budget envelope blocks a call, the adapter MUST surface the condition as `RATE_LIMITED` per § 4 and yield to the multi-day backfill behavior in § 10.
- Budget tracking MUST persist across sessions. Multi-day backfills resume against accumulated budget consumption, not against a fresh budget.
- Budget tracking MUST be per-source. Cross-source budgets are not coordinated (per ADR-013).

**Out of scope for § 5.3.** Algorithm shape (token-bucket, sliding-window, fixed-window, leaky-bucket, exponential-backoff-on-429), persistence mechanism (DB table, JSONB on existing entity, separate ledger), and reset-detection logic (rolling window inference, wall-clock midnight assumption, observed-reset-event tracking) are implementation choices not specified by this spec. Implementers select these based on observed source behavior and operational measurement.

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

### Metrics — multi-day backfill (new in v1.1)

The following metrics are extensions naturally surfaced by multi-day backfill behavior. They are not new fields — they are aggregations or filtered views over the existing `sl_capture_events` log.

| Metric | Granularity | Derivation |
|---|---|---|
| Per-source budget consumption rate | Per-minute, per-day; per source | Event-stream filtered by `provider_id` (or by source identifier when adapters surface that in `metadata`) |
| Budget-exhausted blocking events | Count per source per day | Events where `error_code = RATE_LIMITED` and `metadata` distinguishes budget-exhausted sub-case |
| Multi-day backfill resumption events | Count of distinct backfill runs per source | Identified by resumption pattern in event stream |

These metrics are observable with existing fields. No schema additions.

### Traceability Test

Given only `sl_capture_events` and an `article_id`, a full ingestion timeline must be reconstructible without querying any other table. This is a hard requirement for the event schema.

---

## 9. Consistency Model Declaration

> **Signal Ledger v1 operates under strong consistency at the article level — single atomic transaction, immediate commit — with eventual consistency at the embedding level via a deferred async pipeline with 3 total attempts (Attempt 1 → wait 2s → Attempt 2 → wait 8s → Attempt 3 → terminal). The append-only capture event log is the immutable audit source of truth. Canonical tables govern operational state. Gap windows are manual-triage signals with no automated closure threshold.**

Budget governance for upstream content sources operates at the source-adapter layer per ADR-013 and § 10. It does not alter the article-level or embedding-level consistency posture above.

---

## 10. Multi-Day Backfill Behavior

This section specifies the behavioral contract for backfill operations that span multiple sessions because the v1 corpus exceeds the per-source daily budget envelope. It is the consumer-facing contract that ADR-013 anticipates and that the source-adapter implementation must satisfy.

### 10.1 Stance

Backfill operations are multi-day, resumable, and budget-aware by design. A single backfill operation is not assumed to complete in a single session. The contract surfaces here, at the behavioral layer, what ADR-013 records at the architectural layer.

### 10.2 Behavioral Contract

The source adapter MUST satisfy the following observable behaviors:

1. **Budget-respecting.** The adapter MUST NOT issue any upstream call that would cause cumulative consumption to exceed any per-source budget documented in DD v0.3 § Upstream Source Properties. The constraint applies to all calls — initial attempts, retries, and embedding-pipeline-triggered fetches.

2. **Yielding on exhaustion.** When the budget envelope blocks a call, the adapter MUST yield rather than block, fail-fast, or busy-wait. Yielding means the adapter returns control to the caller (or to a backfill scheduler) with a `RATE_LIMITED` response and sufficient `metadata` for the caller to know the budget was the cause and approximately when retry could succeed (e.g., `next_retry_eligible_at` timestamp where inferable).

3. **Persistent across sessions.** Budget consumption state MUST persist across sessions. A backfill resumed in session N+1 MUST consult the same budget state that was being consumed in session N, not a fresh per-session budget.

4. **No work duplication on resumption.** A backfill resumed across sessions MUST NOT re-ingest articles already successfully ingested in prior sessions. This contract is satisfied by the existing § 5 idempotency key `(provider_id, external_id)` and the unique constraint on `sl_articles`. § 10 does not add a new mechanism.

5. **Per-session bounded.** Per-session work is bounded by available budget at session start, not by total corpus size. A session that begins with depleted budget is permitted to perform zero ingestion calls and complete cleanly.

6. **Per-source independence.** A budget exhaustion on Source A MUST NOT block work against Source B. Adapters are independent (per ADR-013); their budget envelopes are independent.

### 10.3 What the contract does not require

- The adapter is not required to implement a specific backoff algorithm. § 5.3 explicitly defers algorithm choice.
- The adapter is not required to predict reset events. The adapter may consume budget reactively against observed responses, or may track consumption proactively against assumed reset semantics; either approach is consistent with the contract.
- The adapter is not required to coordinate with a global scheduler. A single-adapter implementation that owns its own scheduling loop satisfies the contract.
- The adapter is not required to surface a progress percentage or completion estimate. Multi-day backfill is an observable property of the system; predicting completion time is not.

### 10.4 Resumption posture

Resumption behavior is a property of the design, not a separate mechanism. A backfill-in-progress is identified by:

- Articles in the source-side article inventory that do not have corresponding `sl_articles` rows for the active provider, AND
- Sufficient budget to attempt at least one ingestion call.

When both conditions hold, the adapter resumes. When budget is depleted, the adapter yields. When all source-side articles have corresponding `sl_articles` rows, the backfill is complete. No explicit "resume from last successful event_id" protocol is specified; the idempotency key and the standard ingestion flow handle the case naturally.

### 10.5 Failure modes

| Condition | Behavior |
|---|---|
| Budget exhausted mid-session | Adapter yields. Returns `RATE_LIMITED` with budget-exhausted sub-case metadata. Backfill resumable in subsequent session. |
| Token expiration mid-session | Adapter re-authenticates per source's auth model. If re-auth fails, surfaces as `SYSTEM_ERROR`; backfill resumable in subsequent session after operator triage. |
| Source returns transient error mid-session | Adapter applies § 5.1 per-call retry within budget envelope. If budget envelope blocks the retry, transitions to budget-exhausted yielding behavior. |
| Source returns terminal error mid-session | Adapter records `ingestion_failed` per § 3, advances to next article. Terminal failures do not block the backfill. |
| Session interrupted (process exit, network drop) | No special protocol. On next session start, resumption posture per § 10.4 applies. |

### 10.6 Out of scope for § 10

- Specific scheduler implementation (cron job, manual trigger, daemon, in-process loop).
- Specific alerting on budget exhaustion (operator notification mechanism).
- Specific metrics dashboards for multi-day operations (general observability is § 8).
- Cross-provider scheduling priorities (which provider runs first when multiple are pending).
- v1.5+ concerns: cross-source rate-limit pools, shared schedulers, AegisRelay-mediated multi-tenant budget governance.

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

Per Gee's sequencing recommendation (carried forward from v1.0):

1. Add/verify `embedding_status` lifecycle support
2. Implement `sl_ingest_article` happy path and article-write failure path
3. Implement deterministic error mapper
4. Implement idempotency enforcement on `(provider_id, external_id)`
5. Implement async embedding worker
6. Implement retry chain with `retry_of_event_id`
7. Implement gap-window optimistic JSONB mutation
8. Add observability fields + metrics
9. Run failure-path tests before happy-path polish

(v1.1 budget-aware backfill behavior is implemented at the source-adapter layer, separate from the C2 ingestion sequence above. The implementation sequence for adapter-layer budget governance is implementer's call per § 5.3 and § 10.6.)

---

*Signal Ledger Functional Spec v1.1 — LOCKED 2026-05-05. Supersedes v1.0.*
*Behavioral extension to v1.0 per ADR-013 (rate-limit budget governance for upstream content sources). Backward-flow correction per LENS Governance Addendum v0.1 principle G4. Algorithm shape and persistence mechanism deferred to implementation; behavioral contract specified.*
