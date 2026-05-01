# Signal Ledger — Pre-Functional-Spec Amendment v0.1

**Status:** DRAFT — for Jonathan review  
**Date:** 2026-05-01  
**Author:** Gee, independent strategic counsel  
**LENS Chain Position:** Interstitial amendment between Layer 3 and Layer 4  
**Applies To:** Charter v0.1, Use Case Spec v0.1, Data Dictionary v0.1  
**Precedes:** Functional Spec v0.1  
**Purpose:** Resolve architectural ambiguities before Functional Spec work locks ingestion workflow, SL MCP tool signatures, embedding model selection, and schema DDL.

---

## 1. Governance Posture

This amendment does **not** rewrite or unlock the three prior LENS artifacts.

It records the specific corrections, clarifications, and Functional Spec gating decisions required before Layer 4 proceeds to implementation-level detail.

Recommended handling:

1. Claude consumes this amendment before drafting the Functional Spec.
2. Any changes to locked layers are captured as explicit amendment references, not silent edits.
3. The ADR Log records the decisions that survive this amendment pass.
4. The Functional Spec treats this document as binding input unless Jonathan overrides it.

---

## 2. Readiness Verdict

**Verdict:** Proceed with noted cautions.

The Signal Ledger architecture is sound enough to advance. The governing concept — a single, dated corpus serving both trajectory-preserving reference and subscription decision support — is coherent.

The system should **not** proceed directly into DDL or MCP tool signature lock until the issues below are resolved.

The risk is not that the architecture is wrong. The risk is that the current model under-specifies several concepts the Charter already treats as first-class:

- six retrieval modes, not five
- cultivation without violating immutability
- failure data as infrastructure
- sub-article retrieval targets
- evidence-backed evaluative sessions
- operational prompt kit lifecycle state
- embedding model and vector dimension coupling

---

## 3. Required Corrections Before Functional Spec

### AM-01 — Normalize Charter Lock Status

**Issue:** The project posture treats the Charter as locked, but the Charter file header still says `Draft v0.1 — Pending Jonathan review and lock`.

**Why it matters:** LENS governance depends on layer status being unambiguous. Functional Spec should not inherit uncertainty about whether Layer 1 is canonical.

**Required action:** Record one of the following before Layer 4 opens:

- Charter v0.1 is locked as-is except for amendment references; or
- Charter v0.1 requires a formal lock update; or
- Charter v0.1 remains draft and Layer 4 is blocked.

**Recommendation:** Treat Charter v0.1 as locked by Jonathan decision, with this amendment attached as a pre-Functional-Spec correction note.

---

### AM-02 — Correct Retrieval Mode Count and Test Coverage

**Issue:** The Charter says “Five retrieval modes are first-class,” but enumerates six:

1. Targeted
2. Inferential
3. Framing
4. Audit
5. Evaluative
6. Kit Status

The Use Case Spec correctly models all six. The Charter’s “What Good Looks Like” section lists five behavioral signals and does not explicitly validate Evaluative or Kit Status retrieval.

**Why it matters:** Functional Spec acceptance tests will under-cover the system if they inherit the five-mode framing.

**Required action:** Functional Spec must define tool behavior and acceptance tests for all six retrieval modes.

**Functional Spec implication:** Add a retrieval-mode test matrix with one minimum acceptance scenario per mode:

| Retrieval Mode | Minimum Functional Spec Acceptance Scenario |
|---|---|
| Targeted | Return a specific article, claim, or passage by title/date/topic/keyword with provenance. |
| Inferential | Synthesize Nate’s position across multiple dated articles and preserve temporal deltas. |
| Framing | Retrieve author signposts and rhetorical construction patterns, not merely conclusions. |
| Audit | Produce coverage, completeness, gap, duplicate, and ingestion-health report. |
| Evaluative | Support provider tier assessment using cited corpus evidence and session history. |
| Kit Status | Return prompt kit inventory by lifecycle/evaluation state, including unevaluated kits. |

---

### AM-03 — Resolve Cultivation vs. Immutability

**Issue:** P3 says captured articles are immutable point-in-time artifacts. P5 says artifacts are cultivated, re-tagged, refined, enriched, and partial captures are superseded when access expands.

Current Data Dictionary has one `sl_articles` row per ingested piece and no explicit versioning, supersession, enrichment, or capture-event model.

**Why it matters:** Preview-to-complete and partial-to-complete workflows will either mutate article rows silently or create duplicate articles without a governed relationship.

**Required action:** Functional Spec must define the canonical supersession model before DDL lock.

**Recommended decision:** Use append-only capture events plus stable article identity.

- `sl_articles` remains the canonical article artifact.
- Initial preview/partial/complete capture creates or updates the canonical article shell.
- Every capture attempt is recorded in `sl_capture_events`.
- If a preview or partial capture is later completed, the canonical article may receive completed fields, but the prior capture state remains preserved in event history.
- Any enrichment that changes interpretation, tagging, extraction, or structured fields is logged as a dated cultivation event.

This preserves immutability of source capture history while allowing the cultivated article record to become more complete.

**Alternative:** Versioned article rows using `supersedes_article_id` and `superseded_by_article_id`. This is cleaner for strict immutability but heavier for v1.

**Recommendation for v1:** Avoid full article-version rows unless preview/partial/full bodies must all remain separately queryable. Use `sl_capture_events` plus explicit cultivation metadata.

---

### AM-04 — Reconcile “First-Class” Sub-Artifacts With JSONB Embedding

**Issue:** Charter P8 says cited claims and structured technical content are first-class artifacts with independent retrieval value. Data Dictionary embeds both as JSONB arrays inside `sl_articles`.

**Why it matters:** Embedded JSONB is acceptable storage, but not sufficient by itself for first-class retrieval unless sub-entries have stable identity, provenance, and retrievability.

**Required action:** Functional Spec must define whether claims, signposts, and structured blocks are:

1. embedded-only fields;
2. embedded fields with stable sub-entry IDs; or
3. normalized child tables.

**Recommended v1 decision:** Use embedded JSONB with stable IDs and optional extraction metadata.

Minimum additions:

- `claim_id` inside each cited claim object
- `block_id` inside each structured block object
- `signpost_id` or structured signpost objects instead of plain strings
- `source_span` or `body_offset_start` / `body_offset_end` where feasible
- `extraction_method` where useful: `verbatim`, `a2-extracted`, `a2-paraphrased`
- `created_at` / `extracted_at`

**Functional Spec implication:** Retrieval output must be able to cite not only the article, but the specific claim, signpost, or structured block when applicable.

---

### AM-05 — Add Failure and Capture Event Infrastructure

**Issue:** Charter P11 says failure data is forward-looking infrastructure. Use Case UC-05 requires ingestion health and gap/capture audit. Current Data Dictionary lacks a failure/event table.

**Why it matters:** Failures that occur before an article row exists cannot be represented cleanly. Audit retrieval cannot distinguish all required cases:

- source did not provide content
- source provided preview only
- system failed to capture content
- retry succeeded
- retry failed
- duplicate detected
- URL unreachable
- email backfill unresolved

**Required action:** Add an event/attempt entity before Functional Spec DDL lock.

**Recommended entity:** `sl_capture_events`

Candidate fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `event_id` | UUID | yes | Stable event ID. |
| `provider_id` | UUID FK | yes | Provider being captured. |
| `article_id` | UUID FK nullable | no | Null when capture failed before article creation. |
| `event_type` | enum | yes | `web-ingest`, `email-backfill`, `retry`, `enrichment`, `supersession`, `audit-detection`. |
| `event_status` | enum | yes | `success`, `failed`, `partial`, `preview-only`, `duplicate-detected`, `resolved`, `unresolvable`. |
| `ingestion_source` | enum | yes | `web`, `email-backfill`, `manual`, `mcp-api`, or as Functional Spec finalizes. |
| `attempted_url` | text nullable | no | URL attempted when available. |
| `attempted_title` | text nullable | no | Title known before full capture. |
| `attempted_published_date` | date nullable | no | Publication date if known. |
| `source_vs_system_classification` | enum | yes | `source-not-provided`, `system-failed`, `unknown`, `not-applicable`. |
| `failure_category` | enum nullable | no | `paywall`, `rendering-failure`, `network-error`, `parse-error`, `missing-email`, `schema-drift`, `duplicate`, `unknown`. |
| `retry_count` | integer | yes | Default 0. |
| `raw_error` | text nullable | no | Captured diagnostic detail. |
| `event_notes` | text nullable | no | Human/agent-readable context. |
| `created_at` | timestamptz | yes | Event write timestamp. |

**Functional Spec implication:** Audit retrieval should query both `sl_articles` and `sl_capture_events`.

---

### AM-06 — Add Evidence References to Evaluative Sessions

**Issue:** `sl_evaluative_sessions` records Jonathan’s disposition and evidence summary, but not structured evidence references.

**Why it matters:** The system can preserve the conclusion but cannot prove which captured artifacts supported that conclusion without reconstructing the session from prose.

**Required action:** Functional Spec must define evidence reference storage.

**Recommended v1 addition:** Add `evidence_refs` JSONB array to `sl_evaluative_sessions`.

Candidate object shape:

```json
{
  "ref_type": "article | claim | structured_block | prompt_kit | capture_event",
  "ref_id": "uuid-or-subentry-id",
  "article_id": "uuid-if-applicable",
  "published_date": "YYYY-MM-DD-if-applicable",
  "reason": "short explanation of why this evidence mattered"
}
```

**Functional Spec implication:** Evaluative retrieval should return both the session conclusion and the evidence set that supported it.

---

### AM-07 — Structure Prompt Kit Lifecycle Scheduling

**Issue:** Charter lifecycle semantics include repeat-scheduled and conditionally-deferred states that imply future dates or trigger conditions. Current stamp table only captures disposition and free-text notes.

**Why it matters:** Kit Status retrieval cannot reliably answer operational questions such as:

- Which kits are scheduled for reuse?
- Which kits are due now?
- Which kits are deferred pending a condition?
- Which conditions have not yet been reviewed?

**Required action:** Add structured scheduling fields to `sl_kit_evaluation_stamps` or define a separate kit lifecycle state view.

**Recommended additions to `sl_kit_evaluation_stamps`:**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `next_run_date` | date nullable | no | Required when `repeat_disposition = repeat-scheduled` unless trigger-based. |
| `trigger_condition` | text nullable | no | Required when `repeat_disposition = conditionally-deferred`. |
| `review_after_date` | date nullable | no | Optional date to revisit a deferred kit. |
| `outcome_rating` | enum nullable | no | Optional: `high-value`, `useful`, `low-value`, `failed`, if Jonathan wants operational scoring. |

**Recommendation:** Do not add `outcome_rating` unless Jonathan explicitly wants kit quality scoring in v1. Add `next_run_date`, `trigger_condition`, and `review_after_date` now.

---

### AM-08 — Lock Embedding Model, Dimension, and Chunking Together

**Issue:** Data Dictionary lists embedding model as TBD but assumes `vector(1536)`.

**Why it matters:** Vector dimension is a DDL commitment. If model choice changes, schema changes. If retrieval granularity changes, embedding placement changes.

**Required action:** Functional Spec must lock these together:

1. embedding model
2. vector dimension
3. embedding target: article body, chunks, claims, signposts, structured blocks, or some combination
4. re-embedding policy
5. embedding version metadata

**Recommended v1 decision:**

- Use `text-embedding-3-small` unless there is a specific quality reason to use a larger model.
- Store `embedding_model` and `embedding_version` metadata.
- Avoid a naked `embedding vector(1536)` field with no model lineage.
- Add chunk-level embeddings if inferential/framing retrieval quality is a real v1 requirement, not a demo target.

---

## 4. Recommended Functional Spec Gates

Before Layer 4 is considered draft-complete, it should answer the following gates explicitly.

### Gate 1 — Retrieval Mode Contract

For each of the six retrieval modes, define:

- user intent pattern
- required tool signature
- required filters
- retrieval targets
- ranking strategy
- provenance output
- failure behavior
- acceptance test

### Gate 2 — Ingestion Workflow Contract

Define workflow for:

- web ingestion
- email backfill
- duplicate detection
- preview-only capture
- partial capture
- retry
- enrichment
- supersession/completion
- gap window resolution

### Gate 3 — Event and Audit Contract

Define:

- what creates a capture event
- what creates or updates a gap window
- what constitutes source-not-provided vs system-failed
- retry rules
- audit report format
- minimum evidence included in audit results

### Gate 4 — Embedding and Chunking Contract

Define:

- model
- dimension
- chunking strategy
- chunk boundaries
- embedding targets
- vector indexes
- re-embedding procedure
- model migration behavior

### Gate 5 — Evidence and Evaluation Contract

Define:

- how evaluative sessions retrieve candidate evidence
- how evidence refs are stored
- whether A1 must explicitly confirm evidence before session persistence
- how longitudinal provider evaluation is summarized
- how kit evaluation stamps are written and queried

---

## 5. Proposed DDL-Level Amendments

These are not final DDL. They are schema-level amendments the Functional Spec should evaluate and either adopt or reject explicitly.

### 5.1 Add `sl_capture_events`

Purpose: represent capture attempts, failures, retries, preview-only states, supersession, enrichment, and audit detections.

Rationale: Required for P11, UC-05, preview-to-complete handling, and source-vs-system honesty.

### 5.2 Add Sub-Entry IDs to JSONB Artifacts

Purpose: make cited claims, signposts, and structured blocks retrievable and citeable without immediately normalizing into separate tables.

Candidate additions:

- `claim_id`
- `block_id`
- `signpost_id`
- `source_span` or offsets
- `extraction_method`
- `extracted_at`

Rationale: Required to make P8 operational while keeping v1 schema lightweight.

### 5.3 Add `evidence_refs` to `sl_evaluative_sessions`

Purpose: bind provider-tier decisions to specific corpus evidence.

Rationale: Required for governed subscription decision support.

### 5.4 Add Scheduling Fields to `sl_kit_evaluation_stamps`

Purpose: make Kit Status retrieval operational rather than descriptive.

Candidate additions:

- `next_run_date`
- `trigger_condition`
- `review_after_date`

Rationale: Required for repeat-scheduled and conditionally-deferred lifecycle states to be queryable.

### 5.5 Consider `sl_article_chunks`

Purpose: support precise targeted, inferential, and framing retrieval over long articles.

Candidate fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `chunk_id` | UUID | yes | Stable chunk ID. |
| `article_id` | UUID FK | yes | Parent article. |
| `chunk_index` | integer | yes | Ordered within article. |
| `chunk_type` | enum | yes | `body`, `signpost`, `claim`, `structured_block`, `kit_context`, or final v1 set. |
| `chunk_text` | text | yes | Text embedded and retrieved. |
| `source_span` | text/json nullable | no | Offset or selector. |
| `embedding` | vector | yes | Dimension tied to model. |
| `embedding_model` | text | yes | Model lineage. |
| `created_at` | timestamptz | yes | Write timestamp. |

**Recommendation:** Add `sl_article_chunks` if Functional Spec treats inferential and framing retrieval as production-grade v1 requirements. Skip it only if v1 explicitly accepts article-level semantic retrieval as sufficient.

---

## 6. Proposed SL MCP Tool Surface Direction

The dedicated SL MCP should expose domain tools, not arbitrary database access.

Recommended v1 tool families:

### Ingestion Tools

- `sl_ingest_article_web`
- `sl_ingest_article_email_backfill`
- `sl_record_capture_event`
- `sl_retry_capture`
- `sl_resolve_gap_window`

### Retrieval Tools

- `sl_retrieve_targeted`
- `sl_retrieve_inferential`
- `sl_retrieve_framing`
- `sl_retrieve_audit`
- `sl_retrieve_evaluative`
- `sl_retrieve_kit_status`

### Lifecycle Tools

- `sl_record_kit_evaluation_stamp`
- `sl_record_evaluative_session`
- `sl_get_provider_record`
- `sl_update_provider_record`

### Governance Guardrail

Avoid a generic `sl_execute_sql` tool in normal agent workflow. If SQL execution exists at all, keep it admin-only and outside routine Claude orchestration.

---

## 7. Proposed ADR Entries

The ADR Log should capture these decisions after Functional Spec resolves them.

### ADR-SL-01 — Co-Locate Signal Ledger With OB Supabase Instance

Decision already locked in Data Dictionary. ADR should record rationale and blast-radius mitigation.

### ADR-SL-02 — Dedicated Signal Ledger MCP Over First-Party Supabase MCP

Decision already locked in Data Dictionary. ADR should record context-bloat and tool-surface rationale.

### ADR-SL-03 — Defer AegisRelay Until Separate Productionalization Sprint

Decision already locked in Data Dictionary. ADR should preserve migration path without coupling v1 to relay maturity.

### ADR-SL-04 — Treat OB as Canonical State Bus Only

Decision already locked in Data Dictionary. ADR should define what may and may not be written to OB.

### ADR-SL-05 — Capture Events as the Mechanism for Failure Data and Supersession History

New recommended decision. ADR should explain why v1 uses event history rather than full article-row versioning.

### ADR-SL-06 — Six Retrieval Modes Are First-Class in V1

New corrective decision. ADR should reconcile Charter wording and Use Case Spec structure.

### ADR-SL-07 — Embedding Model, Dimension, and Retrieval Granularity

New required decision. ADR should lock model, vector dimension, embedding targets, chunking, and re-embedding policy.

---

## 8. Functional Spec Session Priority Agenda

Do not start with DDL.

Start with these decisions, in order:

1. **Retrieval granularity:** article-only vs chunk/sub-entry retrieval.
2. **Capture history:** event log vs article version rows.
3. **Evidence binding:** how evaluative sessions cite corpus artifacts.
4. **Prompt kit lifecycle fields:** what makes scheduled/deferred kits queryable.
5. **Embedding lock:** model, dimension, chunking, metadata, re-embedding.
6. **MCP contract:** domain-specific tools and guardrails.
7. **DDL:** only after the above are settled.

---

## 9. Final Counsel

The architecture is not overbuilt. It is correctly ambitious for an agent-first governed corpus.

The danger is under-modeling the parts that make the corpus governed:

- failure history
- evidence lineage
- dated capture evolution
- retrievable sub-artifacts
- operational lifecycle state

If those are handled now, Layer 4 should move cleanly.

If they are deferred, Functional Spec will either become vague or the implementation will quietly violate the Charter.

**Proceed — but lock these decisions before DDL.**
