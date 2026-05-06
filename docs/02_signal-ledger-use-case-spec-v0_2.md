# Signal Ledger — Use Case Spec v0.2

**Status:** LOCKED — 2026-05-03
**Version:** v0.2
**LENS Chain Position:** Layer 2 of 7
**Depends On:** Charter v0.2 (LOCKED 2026-05-03)
**Precedes:** Data Dictionary v0.2 (LOCKED 2026-05-03)
**Supersedes:** Use Case Spec v0.1 (LOCKED 2026-04-29)
**OB Canonical Ref:** TBD on commit
**Tag:** [signal-ledger:use-case-spec-v0.2]

---

## Changes from v0.1

This version is a backward-flow correction per LENS Governance Addendum v0.1, principle G4. Two findings drove the retrofit: a missing structural diagram (G1 requires one at this layer) and a description divergence between Charter v0.2's Framing sub-mode and Use Case Spec v0.1's UC-04.

### Substantive changes

| Change | Reason |
|---|---|
| **Structural diagram added** (per G1) | LENS Governance Addendum v0.1 requires a structural diagram at the Use Case Spec layer. Diagram derivation surfaced two ambiguities (now resolved in this version) and one carry-forward documentation note. |
| **UC-04 Framing sub-mode description expanded** (Path A) | Charter v0.2 §Retrieval Modes broadened the Framing sub-mode to cover both (a) rhetorical-pattern extraction across the corpus and (b) automatic corpus consultation when project context triggers relevance. UC Spec v0.1 only described (a). v0.2 catches up to Charter v0.2 — the authoritative intent layer — without bumping Charter. Path B (narrowing Charter back to UC-04 v0.1 scope) was rejected; it would have discarded a real capability to preserve a stale description. |
| **UC-01 ingestion path named** | v0.1 said "A2 fetches full body text" without naming the fetch component. v0.2 names Executive Circle MCP as the canonical Substack-content fetch path for v1. |
| **UC-02 ingestion sub-paths separated, with priority assigned** | v0.1 collapsed "email forward or paste" into a single description. v0.2 distinguishes the two operational paths and assigns priority: (a) Gmail MCP read is the canonical path; (b) chat paste is fallback only, used when (a) is unavailable. Both produce identical downstream artifacts but differ in which trust boundary the content crosses. Relevant to Threat Model v0.1. |

### Documentation note (no behavior change)

The async embedding worker referenced in Functional Spec §2 is a runtime component internal to the Signal Ledger MCP infrastructure, not a separate actor. UC Spec describes actor-level behavior; "A2 executes" for ingestion encompasses MCP-internal deferred work (per Functional Spec §6: all reads/writes via MCP tools and edge functions). This was implicit in v0.1; v0.2 names it explicitly in §Architectural Decisions to remove the ambiguity for downstream readers.

### Non-changes

- Actor inventory unchanged (A1, A2, A3)
- Use case index unchanged (UC-01 through UC-09)
- Sub-mode pattern (UC-04) unchanged structurally — only Framing description expanded
- Architectural decisions from v0.1 stand
- Out of scope unchanged
- LENS chain position updated to "Layer 2 of 7" per Governance Addendum v0.1

### Re-validation against Charter v0.2 and Data Dictionary v0.2

- Charter v0.2: UC-04 Framing description now consistent with Charter §Retrieval Modes. No further divergence.
- Data Dictionary v0.2: UC references to entities (`sl_articles`, `sl_prompt_kits`, `sl_kit_evaluation_stamps`, `sl_evaluative_sessions`, `sl_provider_records`) remain valid. New entities `sl_capture_events` (E7) and `sl_signpost_embeddings` (E8) are infrastructure-level — they support UC-01/UC-02 execution and UC-05 audit retrieval but are not surfaced as separate use cases. No re-litigation needed.

---

## Actor Inventory

| ID | Actor | Type | Role |
|---|---|---|---|
| A1 | Jonathan | Human | Sole human actor v1. Initiates all ingestion, retrieval, and evaluation actions. |
| A2 | Claude | AI | Sole writer and orchestrator v1. Executes all system writes via MCP tools. Internal MCP runtime components (e.g., async embedding worker per Functional Spec §2) are encompassed by A2's executor role and not enumerated separately. |
| A3 | Nate B. Jones Substack | External source | Read-only. Content origin. No system writes. |

---

## Component Inventory

Components are runtime entities that participate in actor flows but are not themselves actors. Named here so the structural diagram and prose agree on terminology.

| ID | Component | Role |
|---|---|---|
| C1 | Executive Circle MCP | Canonical Substack content fetch path for v1 (UC-01). Authenticated read access to subscribed content. |
| C2 | Signal Ledger MCP | Dedicated Supabase Edge Function. Sole write path to `sl_*` tables. Sole read path for retrieval use cases. Encompasses the async embedding worker per Functional Spec §2. |
| C3 | Supabase Postgres + pgvector | Persistent store for all `sl_*` entities (E1–E8 per Data Dictionary v0.2). |
| C4 | Gmail MCP | Email-backfill ingestion path for UC-02 sub-path (a). Read access to Jonathan's Gmail. |
| C5 | OpenAI Embedding API | External service. Called by C2's embedding worker. Model: `text-embedding-3-small` (locked in Functional Spec §2). |

---

## Structural Diagram

The diagram below shows actors, components, and data flows for v1. Per G2, it was re-derived against Charter v0.2, Data Dictionary v0.2, and Functional Spec v1.0 — not copied from any prior session draft. Findings surfaced during derivation are recorded in §Changes from v0.1.

```mermaid
flowchart TB
    A1["A1 — Jonathan<br/>(human)"]
    A2["A2 — Claude<br/>(AI orchestrator)"]
    A3["A3 — Nate B. Jones Substack<br/>(external read-only source)"]

    C1["C1 — Executive Circle MCP<br/>(Substack content fetch)"]
    C2["C2 — Signal Ledger MCP<br/>(Edge Function; encompasses<br/>async embedding worker)"]
    C3[("C3 — Supabase<br/>Postgres + pgvector<br/>sl_* tables E1–E8")]
    C4["C4 — Gmail MCP<br/>(email-backfill read)"]
    C5["C5 — OpenAI Embedding API<br/>(text-embedding-3-small)"]

    A1 -->|chat: ingest / retrieve / evaluate| A2

    %% UC-01 web path
    A2 -->|UC-01: fetch article| C1
    C1 -.->|HTTP read| A3
    A3 -.->|article content| C1
    C1 -->|article content| A2

    %% UC-02 sub-paths
    A2 -->|UC-02a canonical: read via Gmail MCP| C4
    C4 -->|email content| A2
    A1 -.->|UC-02b fallback: paste in chat| A2

    %% Write path (UC-01, UC-02, UC-06, UC-08)
    A2 -->|sl_ingest_article<br/>sl_record_kit_evaluation<br/>sl_record_evaluative_session| C2
    C2 -->|writes E1–E7| C3

    %% Async embedding (internal to C2)
    C2 -->|embedding request| C5
    C5 -->|vector(1536)| C2
    C2 -->|writes E8| C3

    %% Read path (UC-03 through UC-07, UC-09)
    A2 -->|sl_query_*<br/>retrieval modes| C2
    C2 -->|reads E1–E8| C3
    C3 -->|results| C2
    C2 -->|results| A2
    A2 -->|response| A1

    classDef actor fill:#EEEDFE,stroke:#534AB7,color:#26215C
    classDef component fill:#E1F5EE,stroke:#0F6E56,color:#04342C
    classDef store fill:#FAEEDA,stroke:#854F0B,color:#412402
    classDef external fill:#F1EFE8,stroke:#5F5E5A,color:#2C2C2A

    class A1,A2 actor
    class A3,C5 external
    class C1,C2,C4 component
    class C3 store
```

**Trust boundary note:** Article content crosses from external (A3 / Substack) into the system at two points — C1 (web path, UC-01) and either C4 or the chat surface (email path, UC-02). Once stored in C3 via C2, the content is read back to A2 during retrieval use cases. The trust posture of `body_text` when surfaced to A2 — instructions vs untrusted data — is deferred to Threat Model v0.1 per the addendum's required threat-modeling discipline. Use Case Spec describes the flow; Threat Model classifies the trust boundary.

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
**Components:** C1 (Executive Circle MCP), C2 (Signal Ledger MCP), C3 (Supabase), C5 (OpenAI Embedding API)
**Precedes:** UC-03, UC-04, UC-05, UC-06, UC-07
**Description:** A1 provides a Substack article URL. A2 fetches full body text via C1 (Executive Circle MCP), extracts metadata, and writes to `sl_articles` via C2. Author signposts and structured technical content extracted and stored if present. `capture_completeness` set at ingestion time. Capture event sequence written to `sl_capture_events` per Functional Spec §3. Embedding generation is deferred per Functional Spec §2 and executed by the async worker internal to C2; embedding failures do not roll back the article write.

### UC-02 — Ingest Article: Email Backfill Path
**Actor:** A1 initiates; A2 executes
**Components:** C2, C3, C5; plus C4 (Gmail MCP) for sub-path (a) only
**Sub-paths:**
- **(a) Email read — canonical path.** A2 reads forwarded article content from Jonathan's Gmail via C4 (Gmail MCP). This is the default UC-02 execution path.
- **(b) Chat paste — fallback only.** A1 pastes article content directly into the chat surface; A2 receives content as user message text without traversing C4. Used only when (a) is unavailable (e.g., Gmail MCP not connected, message not retrievable, or Jonathan deliberately chooses to paste). Not co-equal to (a).
**Precedes:** UC-03, UC-04, UC-05, UC-06, UC-07
**Description:** A2 processes content identically to UC-01 except `ingestion_source = email-backfill`. URL may be null. Resolves the known gap window (2026-02-12 through 2026-02-21, 10 articles per Charter §Scope). Gap window `status` updated per Functional Spec §7 lifecycle on successful backfill. Sub-paths (a) and (b) produce identical downstream artifacts but cross different trust boundaries (relevant to Threat Model v0.1).

### UC-03 — Targeted Retrieval
**Retrieval Mode:** Targeted
**Actor:** A1 initiates; A2 executes and returns
**Components:** C2, C3
**Precedes:** —
**Depends On:** UC-01 or UC-02
**Description:** A1 asks for a specific article, claim, or piece of content by reference (title, date, topic, keyword). A2 performs vector + filtered query via C2, returns matched content with provenance. P3 honored — `published_date` surfaced with every result.

### UC-04 — Inferential / Framing Retrieval
**Retrieval Mode:** Inferential; Framing (sub-mode)
**Actor:** A1 initiates; A2 resolves sub-mode, executes, returns
**Components:** C2, C3
**Precedes:** —
**Depends On:** UC-01 or UC-02
**Description:** A1 asks a question — explicitly or implicitly — about Nate's positions, arguments, or rhetorical patterns across the corpus. A2 disambiguates sub-mode before proceeding:

- **Inferential (default).** What Nate argues or concludes across time. Draws on `cited_claims` and `body_text`. The conclusion, not the lens.

- **Framing (sub-mode).** Has two related behaviors, both consistent with Charter v0.2 §Retrieval Modes:
  - **Rhetorical-pattern extraction.** A1 asks how Nate constructs an argument rhetorically. The lens, not the conclusion. Draws on `author_signposts` and `structured_technical_content`.
  - **Automatic corpus consultation.** When project context indicates relevance to Nate's body of work, A2 proactively consults the corpus before responding — not after. The trigger is contextual rather than an explicit A1 request. Consultation surface is the same as rhetorical-pattern extraction: `author_signposts` and `structured_technical_content`. The corresponding behavioral signal (Charter §What Good Looks Like, signal 3) is the validation criterion.

Sub-mode ambiguity (where present) resolved by A2 via clarifying question before query execution. A1 may declare sub-mode explicitly. Automatic corpus consultation does not require A1 declaration — it is dispatched on context.

### UC-05 — Audit Retrieval
**Retrieval Mode:** Audit
**Actor:** A1 initiates; A2 executes and returns
**Components:** C2, C3
**Precedes:** —
**Depends On:** UC-01 or UC-02
**Description:** A1 requests a corpus audit — gap detection, `capture_completeness` inventory, date range coverage, or ingestion health. A2 queries `sl_articles` by `published_date` range and `capture_completeness`, and may join `sl_capture_events` for failure-pattern reconstruction. Returns structured report. Failure data surfaced as forward-looking infrastructure (P11).

### UC-06 — Evaluative Retrieval
**Retrieval Mode:** Evaluative
**Actor:** A1 initiates; A2 executes and returns
**Components:** C2, C3
**Precedes:** —
**Depends On:** UC-01 or UC-02; UC-09 precedes
**Description:** A1 initiates a subscription evaluation session. A2 retrieves corpus evidence supporting tier assessment via C2. Session result persisted as a new `sl_evaluative_sessions` record (accumulating, never overwritten). Longitudinal session history supports tier decisions over time: maintain-current-tier / upgrade-candidate / degradation-signal / abandon-signal.

### UC-07 — Kit Status Retrieval
**Retrieval Mode:** Kit Status
**Actor:** A1 initiates; A2 executes and returns
**Components:** C2, C3
**Precedes:** —
**Depends On:** UC-08 precedes (stamps must exist to be inventoried)
**Description:** A1 requests prompt kit inventory filtered by evaluation state. A2 queries `sl_prompt_kits` joined to `sl_kit_evaluation_stamps` via C2. Kits with no stamps surface as unevaluated (default state). A1 may filter by disposition or view full inventory.

### UC-08 — Record Prompt Kit Evaluation
**Actor:** A1 initiates; A2 writes
**Components:** C2, C3
**Precedes:** UC-07
**Depends On:** Kit must exist (written at ingestion or separately)
**Description:** A1 provides execution context and disposition after having used a prompt kit. A2 appends a new evaluation stamp to `sl_kit_evaluation_stamps` via C2. Stamp is only written on explicit A1 declaration — unevaluated is the absence of a stamp, not a stamp value. Valid dispositions: `repeat-scheduled` / `conditionally-deferred` / `one-time`.

### UC-09 — View Provider Record
**Actor:** A1 initiates; A2 returns
**Components:** C2, C3
**Precedes:** UC-06
**Depends On:** Provider Record must exist
**Description:** A1 requests the current state of the Nate B. Jones provider record. A2 returns full provider record via C2 including `subscription_tier`, `corpus_start_date`, `article_count`, `last_ingestion_date`, and `gap_windows`. Surfaced as context before UC-06 to ground evaluative sessions in current provider state.

---

## Architectural Decisions Locked in This Spec

The following decisions are unchanged from v0.1 unless explicitly noted as new in v0.2.

**UC-04 sub-mode pattern:** Inferential and Framing are a single use case with a sub-mode parameter, not two separate use cases. Rationale: they share the same actor flow, corpus, and query surface — only the extraction target and synthesis framing differ. Sub-mode ambiguity is A2's responsibility to resolve before execution. **Updated in v0.2:** Framing sub-mode includes both rhetorical-pattern extraction and automatic corpus consultation per Charter v0.2.

**Unevaluated as default state (UC-07 / UC-08):** Unevaluated is the default lifecycle state for any prompt kit with no intentional review stamp. A stamp is only written when A1 has explicitly reviewed and declared a disposition after execution. Unevaluated is not a disposition value — it is the structural absence of any stamp record.

**Evaluative session persistence (UC-06):** Evaluative sessions accumulate as independent records and are never overwritten. Longitudinal session history is the evidence base for tier decisions. A single session is insufficient basis for upgrade or abandon decisions — the pattern across sessions is the signal.

**Precedes convention applied spec-wide:** Each use case declares downstream dependencies. Ingestion UCs (UC-01, UC-02) precede all retrieval UCs. UC-09 precedes UC-06. UC-08 precedes UC-07.

**MCP-internal runtime components are not actors (new in v0.2):** A2's executor role encompasses runtime components that are part of MCP infrastructure — including the async embedding worker defined in Functional Spec §2. UC Spec describes actor-level behavior; runtime decomposition lives in Functional Spec. This convention prevents UC Spec from re-litigating runtime details every time the implementation evolves.

**Ingestion-path naming (new in v0.2):** v1 names two distinct ingestion paths — UC-01 (web, via C1) and UC-02 (email-backfill, via C4 sub-path or chat-paste sub-path). Future ingestion paths will be added as new UCs rather than as sub-paths of existing UCs unless they share the actor flow and content shape exactly.

---

## Out of Scope — v1

(Unchanged from v0.1.)

- Multi-provider corpus
- Cross-provider comparative retrieval
- Automated ingestion scheduling
- External publishing or sharing of corpus artifacts
- Multi-writer orchestration (AegisRelay v1.5+)

---

## Open Questions

| OQ ID | Question | Status |
|---|---|---|
| OQ-UC-01 | Should UC-04 Framing's automatic corpus consultation behavior have its own behavioral signal beyond Charter §What Good Looks Like signal 3? | **Open** — defer to Definition of Done v0.1, where behavioral signals become test scenarios. |

---

## Tag

`[signal-ledger:use-case-spec-v0.2]`

---

*Signal Ledger Use Case Spec v0.2 — LOCKED 2026-05-03. Supersedes v0.1.*
*Backward-flow correction per LENS Governance Addendum v0.1 principle G4.*
