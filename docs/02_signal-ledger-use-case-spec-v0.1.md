# Signal Ledger — Use Case Spec v0.1

**Status:** LOCKED — 2026-04-29
**LENS Chain Position:** Layer 2 of 6
**Depends On:** Charter v0.1 (OB: cfdd4870-a2b4-4d88-aad7-d3f229e57310)
**Precedes:** Data Dictionary v0.1
**OB Canonical Ref:** 91c4c36e-4333-48ff-8af5-66bfb58cb6d4
**Tag:** [signal-ledger:use-case-spec-v0.1]

---

## Actor Inventory

| ID | Actor | Type | Role |
|---|---|---|---|
| A1 | Jonathan | Human | Sole human actor v1. Initiates all ingestion, retrieval, and evaluation actions. |
| A2 | Claude | AI | Sole writer and orchestrator v1. Executes all system writes. |
| A3 | Nate B. Jones Substack | External source | Read-only. Content origin. No system writes. |

---

## Use Case Index

| UC ID | Name | Retrieval Mode | Primary Principles |
|---|---|---|---|
| UC-01 | Ingest Article — Web Path | — | P3, P12 |
| UC-02 | Ingest Article — Email Backfill Path | — | P3, P11, P12 |
| UC-03 | Targeted Retrieval | Targeted | P1, P3 |
| UC-04 | Inferential / Framing Retrieval | Inferential; Framing (sub-mode) | P4, P7, P8 |
| UC-05 | Audit Retrieval | Audit | P5, P11 |
| UC-06 | Evaluative Retrieval | Evaluative | P2, P10 |
| UC-07 | Kit Status Retrieval | Kit Status | P5, P6 |
| UC-08 | Record Prompt Kit Evaluation | — | P5, P6 |
| UC-09 | View Provider Record | — | P10 |

---

## Use Case Descriptions

### UC-01 — Ingest Article: Web Path
**Actor:** A1 initiates; A2 executes
**Precedes:** UC-03, UC-04, UC-05, UC-06, UC-07
**Description:** A1 provides a Substack article URL. A2 fetches full body text, extracts metadata, generates embedding, and writes to `sl_articles`. Author signposts and structured technical content extracted and stored if present. capture_completeness set at ingestion time.

### UC-02 — Ingest Article: Email Backfill Path
**Actor:** A1 initiates; A2 executes
**Precedes:** UC-03, UC-04, UC-05, UC-06, UC-07
**Description:** A1 provides article content via email forward or paste. A2 processes identically to UC-01 except ingestion_source = email-backfill. URL may be null. Resolves known gap window (2026-02-12 through 2026-02-21, 10 articles). Gap window resolution_status updated on successful backfill.

### UC-03 — Targeted Retrieval
**Retrieval Mode:** Targeted
**Actor:** A1 initiates; A2 executes and returns
**Precedes:** —
**Depends On:** UC-01 or UC-02
**Description:** A1 asks for a specific article, claim, or piece of content by reference (title, date, topic, keyword). A2 performs vector + filtered query, returns matched content with provenance. P3 honored — published_date surfaced with every result.

### UC-04 — Inferential / Framing Retrieval
**Retrieval Mode:** Inferential; Framing (sub-mode)
**Actor:** A1 initiates; A2 resolves sub-mode, executes, returns
**Precedes:** —
**Depends On:** UC-01 or UC-02
**Description:** A1 asks a question about Nate's positions, arguments, or rhetorical patterns across the corpus. A2 disambiguates sub-mode before proceeding:
- **Inferential** — what Nate argues or concludes across time. Draws on cited_claims and body_text.
- **Framing** — how Nate constructs an argument rhetorically. The lens, not the conclusion. Draws on author_signposts and structured_technical_content.

Sub-mode ambiguity resolved by A2 via clarifying question before query execution. A1 may declare sub-mode explicitly.

### UC-05 — Audit Retrieval
**Retrieval Mode:** Audit
**Actor:** A1 initiates; A2 executes and returns
**Precedes:** —
**Depends On:** UC-01 or UC-02
**Description:** A1 requests a corpus audit — gap detection, capture_completeness inventory, date range coverage, or ingestion health. A2 queries `sl_articles` by published_date range and capture_completeness, returns structured report. Failure data surfaced as forward-looking infrastructure (P11).

### UC-06 — Evaluative Retrieval
**Retrieval Mode:** Evaluative
**Actor:** A1 initiates; A2 executes and returns
**Precedes:** —
**Depends On:** UC-01 or UC-02; UC-09 precedes
**Description:** A1 initiates a subscription evaluation session. A2 retrieves corpus evidence supporting tier assessment. Session result persisted as new `sl_evaluative_sessions` record (accumulating, never overwritten). Longitudinal session history supports tier decisions over time: maintain-current-tier / upgrade-candidate / degradation-signal / abandon-signal.

### UC-07 — Kit Status Retrieval
**Retrieval Mode:** Kit Status
**Actor:** A1 initiates; A2 executes and returns
**Precedes:** —
**Depends On:** UC-08 precedes (stamps must exist to be inventoried)
**Description:** A1 requests prompt kit inventory filtered by evaluation state. A2 queries `sl_prompt_kits` joined to `sl_kit_evaluation_stamps`. Kits with no stamps surface as unevaluated (default state). A1 may filter by disposition or view full inventory.

### UC-08 — Record Prompt Kit Evaluation
**Actor:** A1 initiates; A2 writes
**Precedes:** UC-07
**Depends On:** Kit must exist (written at ingestion or separately)
**Description:** A1 provides execution context and disposition after having used a prompt kit. A2 appends a new evaluation stamp to `sl_kit_evaluation_stamps` for the relevant kit. Stamp is only written on explicit A1 declaration — unevaluated is the absence of a stamp, not a stamp value. Valid dispositions: repeat-scheduled / conditionally-deferred / one-time.

### UC-09 — View Provider Record
**Actor:** A1 initiates; A2 returns
**Precedes:** UC-06
**Depends On:** Provider Record must exist
**Description:** A1 requests the current state of the Nate B. Jones provider record. A2 returns full provider record including subscription_tier, corpus_start_date, article_count, last_ingestion_date, and gap_windows. Surfaced as context before UC-06 to ground evaluative sessions in current provider state.

---

## Architectural Decisions Locked in This Spec

**UC-04 sub-mode pattern:** Inferential and Framing are a single use case with a sub-mode parameter, not two separate use cases. Rationale: they share the same actor flow, corpus, and query surface — only the extraction target and synthesis framing differ. Sub-mode ambiguity is A2's responsibility to resolve before execution.

**Unevaluated as default state (UC-07 / UC-08):** Unevaluated is the default lifecycle state for any prompt kit with no intentional review stamp. A stamp is only written when A1 has explicitly reviewed and declared a disposition after execution. Unevaluated is not a disposition value — it is the structural absence of any stamp record.

**Evaluative session persistence (UC-06):** Evaluative sessions accumulate as independent records and are never overwritten. Longitudinal session history is the evidence base for tier decisions. A single session is insufficient basis for upgrade or abandon decisions — the pattern across sessions is the signal.

**Precedes convention applied spec-wide:** Each use case declares downstream dependencies. Ingestion UCs (UC-01, UC-02) precede all retrieval UCs. UC-09 precedes UC-06. UC-08 precedes UC-07.

---

## Out of Scope — v1

- Multi-provider corpus
- Cross-provider comparative retrieval
- Automated ingestion scheduling
- External publishing or sharing of corpus artifacts
- Multi-writer orchestration (AegisRelay v1.5+)

---

## Open Questions

None. All open questions resolved at lock.
