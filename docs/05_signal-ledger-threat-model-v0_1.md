# Signal Ledger — Threat Model v0.1

**Status:** LOCKED — 2026-05-04
**Version:** v0.1
**LENS Chain Position:** Layer 5 of 7
**Depends On:** Charter v0.2 (LOCKED 2026-05-03), Use Case Spec v0.2 (LOCKED 2026-05-03), Data Dictionary v0.2 (LOCKED 2026-05-03), Functional Spec v1.0 (LOCKED 2026-05-01)
**Precedes:** ADR Log v0.1 (NOT STARTED)
**Governance:** LENS Governance Addendum v0.1 (LOCKED 2026-05-03)
**Calibration tier:** Personal but agent-readable (medium STRIDE per Addendum G3)

---

## 1. Purpose

This document is Signal Ledger's first dedicated threat model under LENS Governance Addendum v0.1, principle G3. It exists as a separate artifact from the ADR Log because the two answer different questions: ADRs record *why we chose what we chose*; the threat model records *what attacks we considered, which we mitigated, and which we accepted as residual risk*.

Threat Model v0.1 covers Signal Ledger v1 — single-provider (Nate B. Jones), Substack-only ingestion, ~100 article corpus, single-user (Jonathan), agent-readable. Multi-provider, multi-user, or external-publishing scope changes invalidate this version and require a new threat model.

---

## 2. Methodology

**Framework:** STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege).

**Calibration:** Medium per Addendum G3 calibration table — personal but agent-readable. Explicit attention to prompt injection and trust boundaries between captured content and agent reasoning. Time budget: 1–2 hours.

**Production order per Addendum G2:**
1. Trust boundary diagram drawn first as discovery instrument
2. Boundary derivation surfaced findings the prose did not name
3. STRIDE pass run against the diagrammed boundaries
4. Agent trust boundary subsection authored separately per G3
5. Backward-flow check per G4 — no upstream artifact corrections triggered

**Locked inputs to this threat model (not re-litigated):**
- A2 treats retrieved `body_text` as **untrusted data**. Body text captures opinions, claims, and rhetorical content from content producers. It is the subject of A2's analysis, not a source of directives to A2. Imperative-sounding language inside captured content is content *about* the world, not instructions *to* the system. (Locked 2026-05-03 by Jonathan.)

---

## 3. Trust Boundary Diagram

Per Addendum G1, every layer that defines structure must produce a visual artifact at lock time. The diagram below was re-derived against Charter v0.2, Use Case Spec v0.2, Data Dictionary v0.2, and Functional Spec v1.0 — not copied from prior session drafts.

```mermaid
flowchart TB
    subgraph EXT["UNTRUSTED ZONE — external"]
        A3["A3 — Nate B. Jones Substack<br/>(content publisher)"]
        ATTACKER["Adversary<br/>(controls email forgery,<br/>MitM, source impersonation)"]
    end

    subgraph SEMI["SEMI-TRUSTED ZONE — authenticated externals"]
        C1["C1 — Executive Circle MCP<br/>(Substack content fetch)"]
        C4["C4 — Gmail MCP<br/>(email read)"]
        C5["C5 — OpenAI Embedding API<br/>(text-embedding-3-small)"]
        GMAIL[("Gmail mailbox<br/>jonathan@gmail")]
    end

    subgraph TRUST["TRUSTED ZONE — system identity"]
        A1["A1 — Jonathan<br/>(human operator)"]
        A2["A2 — Claude<br/>(AI orchestrator)"]
        C2["C2 — Signal Ledger MCP<br/>(Edge Function +<br/>async embedding worker)"]
        C3[("C3 — Supabase Postgres<br/>service role, RLS disabled<br/>sl_* tables E1–E8")]
    end

    %% TB-1: External web ingestion
    A3 -.->|TB-1: HTTPS| C1
    C1 -->|article content| A2

    %% TB-2: External email ingestion (canonical)
    A3 -.->|email forward| GMAIL
    ATTACKER -.->|spoofed sender| GMAIL
    GMAIL -->|TB-2a: OAuth read| C4
    C4 -->|email content| A2

    %% TB-2b: Chat paste fallback
    A1 -->|TB-2b: paste in chat| A2

    %% TB-3: Chat surface (A1 → A2)
    A1 -->|chat: ingest / retrieve / evaluate| A2

    %% TB-4: A2 → C2 (system write/read)
    A2 -->|TB-4: MCP tool calls<br/>service role auth| C2
    C2 -->|writes E1–E7| C3
    C3 -->|reads E1–E8| C2
    C2 -->|results| A2

    %% TB-5: A2 retrieval boundary (THE defining boundary)
    C3 -.->|stored body_text<br/>read back to agent| C2
    C2 -.->|TB-5: body_text<br/>(UNTRUSTED DATA<br/>per session 3 lock)| A2

    %% TB-6: Embedding API egress
    C2 -->|TB-6: body_text<br/>over HTTPS| C5
    C5 -->|vector(1536)| C2

    %% TB-7: Service role boundary (inside trusted zone)
    C2 -.->|service role key<br/>full corpus R/W| C3

    %% TB-8: Adversary surface — MitM / endpoint impersonation
    ATTACKER -.->|impersonate C1/C5<br/>endpoint| A2

    %% A2 response surface
    A2 -->|response| A1

    classDef untrusted fill:#FAEEDA,stroke:#854F0B,color:#412402,stroke-width:2px
    classDef semi fill:#F1EFE8,stroke:#5F5E5A,color:#2C2C2A
    classDef trusted fill:#E1F5EE,stroke:#0F6E56,color:#04342C
    classDef adversary fill:#F5D5D5,stroke:#A02020,color:#3A0A0A,stroke-width:2px

    class A3 untrusted
    class ATTACKER adversary
    class C1,C4,C5,GMAIL semi
    class A1,A2,C2,C3 trusted
```

### Trust posture conventions

- **Untrusted:** External sources, content under attacker control, anything outside the system's identity boundary
- **Semi-trusted:** Authenticated external services with their own security posture (Gmail, OpenAI API, Executive Circle MCP) — trusted for the operation requested, not for arbitrary instruction
- **Trusted:** Code paths Jonathan controls — A2 reasoning, C2 (Signal Ledger MCP), C3 storage
- **Locked input:** A2 treats retrieved `body_text` as **untrusted data** regardless of which boundary it crossed

---

## 4. Boundary Inventory

| ID | Boundary | From → To | Trust transition |
|---|---|---|---|
| TB-1 | External web ingestion | A3 (Substack) → C1 → A2 | Untrusted → Semi-trusted → Trusted |
| TB-2a | External email ingestion (canonical) | A3 → Gmail → C4 → A2 | Untrusted → Semi-trusted → Trusted |
| TB-2b | External email ingestion (fallback) | A3 → A1 → chat surface → A2 | Untrusted → Trusted (via A1's clipboard) |
| TB-3 | Chat surface | A1 → A2 | Trusted → Trusted (with implicit chat-surface dependency, see TM-R-01) |
| TB-4 | System write/read | A2 → C2 → C3 | Trusted → Trusted (service role auth) |
| TB-5 | **Storage → Agent retrieval** | C3 → C2 → A2 | Trusted storage → **untrusted data** (locked classification) |
| TB-6 | Embedding API egress | C2 → C5 (OpenAI) | Trusted → Semi-trusted (data leaves system) |
| TB-7 | Service role boundary | C2 (Edge Function) → C3 | Trusted → Trusted (service role key, RLS disabled) |
| TB-8 | Endpoint impersonation surface | Adversary → C1/C5/C4 endpoint posing | Untrusted → impersonating Semi-trusted |

---

## 5. Discoveries Surfaced by the Diagram

Per Addendum G2: *"A diagram that perfectly matches the prose has not done its job."* Five findings the prose did not name. Each was reviewed and resolved before STRIDE pass authoring.

| ID | Finding | Resolution |
|---|---|---|
| D-1 | TB-2a and TB-2b cross **different trust boundaries with different attestation guarantees** despite producing identical artifacts. Prose described them as "fallback only"; diagram made the security difference visible. | **Accepted residual risk.** Personal use; A1 owns clipboard hygiene. Documented in TM-S-03. |
| D-2 | TB-3 (A1 → A2) carries **implicit trust** in the chat surface. A2 doesn't authenticate the principal at the cryptographic level. | **Accepted residual risk.** A1's session and device security is documented as a dependency. Documented in TM-R-01. |
| D-3 | TB-7 service role boundary is internal but consequential — RLS is explicitly disabled per Functional Spec § 6. **The mitigation is operational discipline, not platform-enforced isolation.** | Surfaced as the master threat for several STRIDE findings. Compensating controls documented in TM-E-01. |
| D-4 | TB-8 endpoint impersonation isn't surfaced in any prior artifact. **No prior layer documents that A2/C2 depend on HTTPS cert validation being honored at the runtime layer for outbound calls to C1, C4, C5.** | Documented as explicit architectural assumption in TM-S-04. ADR candidate flagged. |
| D-5 | TB-5 propagation is multi-hop, not single-hop. **Per session 4 lock, the threat model treats TB-5 as a single conceptual edge** — the agent-boundary subsection addresses propagation at the principle level rather than per materialization point. | Single-edge treatment locked. Operational mitigations enumerated in §7. |

---

## 6. STRIDE Findings

### 6.1 Spoofing

| ID | Threat | Boundary | L | I | Status | Notes |
|---|---|---|---|---|---|---|
| TM-S-01 | Source impersonation: someone publishes content under "Nate B. Jones" identity that isn't Nate's | TB-1 | L | M | accepted | Substack platform owns publisher identity. A3 is read-only and authenticated by Substack's TLS + account model. Compromise is Substack's and Nate's, not Signal Ledger's. |
| TM-S-02 | Email forgery: spoofed sender forwards an article that wasn't published by Nate | TB-2a | L | M | mitigated (partial) | Gmail SPF/DKIM/DMARC at the inbox level provides authentication for messages claiming Substack origin. Mitigation isn't perfect — forwarded mail breaks DKIM, and any sender Jonathan whitelisted can submit. **A2 should verify `published_date` against the article's URL/Substack metadata before write** — if the URL resolves to a real post matching the body, forgery is caught at content-canonicalization time. **→ ADR candidate** for ADR Log v0.1: URL-resolution verification at email-backfill ingestion. |
| TM-S-03 | TB-2b chat-paste source unverified | TB-2b | L | L | accepted | Per session 4 lock: A1 owns clipboard hygiene. Personal-use scope; not a multi-user system. No mitigation work; risk acceptance documented. |
| TM-S-04 | MCP server endpoint impersonation (C1, C4, C5) | TB-1, TB-2a, TB-6, TB-8 | L | H | mitigated | HTTPS + certificate validation in the runtime is the implicit mitigation. **The threat model declares this assumption explicit:** Signal Ledger depends on HTTPS cert validation being honored at the runtime layer for all outbound calls to C1, C4, C5. No Signal Ledger code disables cert validation. **→ ADR candidate** for ADR Log v0.1: HTTPS-cert-validation dependency as architectural assumption with no override permitted. |
| TM-S-05 | C2 Edge Function impersonation by another Supabase project or local mock | TB-4 | L | H | mitigated | Service role key is the auth mechanism. Key compromise = TM-E-01. For non-key-compromise impersonation, A2 reaches C2 by deployed Edge Function URL; covered by TM-S-04 cert validation. |

### 6.2 Tampering

| ID | Threat | Boundary | L | I | Status | Notes |
|---|---|---|---|---|---|---|
| TM-T-01 | `body_text` modification between source and storage | TB-1, TB-2a | L | M | mitigated | HTTPS in transit; C2 service role write to C3 in transit. No checksum validation between fetch and write — if a malicious C1 (TM-S-04) returned modified content, the modification would be persisted. Cert validation at TM-S-04 is the upstream mitigation. |
| TM-T-02 | `sl_capture_events` log forgery (after-the-fact tampering) | TB-7 | L | H | accepted | Functional Spec § 3 declares append-only at application discipline level. Postgres permits update/delete at the DB level; service role compromise (TM-E-01) defeats application-discipline append-only. **DB-level append-only enforcement (policy or trigger preventing UPDATE/DELETE on `sl_capture_events`) is not in v1.** Acceptance rationale: service role compromise (TM-E-01) is the parent threat — if that defense fails, application-discipline append-only is also defeated, so DB-level enforcement is not an additive defense against the realistic threat. The compensating control is the service role key staying secret per TM-I-04 / TM-E-01. **→ ADR candidate** for ADR Log v0.1: explicit acceptance of application-discipline-only append-only enforcement. |
| TM-T-03 | `body_text` modification at rest in C3 | TB-7 | L | H | accepted | Same parent threat as TM-T-02 (service role compromise). No separate at-rest mitigation in v1. |

### 6.3 Repudiation

| ID | Threat | Boundary | L | I | Status | Notes |
|---|---|---|---|---|---|---|
| TM-R-01 | A1 denies initiating an ingestion or evaluation | TB-3 | L | L | accepted | Single-user system. Repudiation is conceptually low-impact when there's only one principal. Functional Spec § 6 documents "user-level attribution: not implemented in v1." A1's session and device security is a documented dependency, not an unenumerated assumption. |
| TM-R-02 | Capture event log integrity (already addressed by append-only design) | TB-4 | L | M | mitigated | Functional Spec § 3 append-only design is the repudiation mitigation. Cross-references TM-T-02 — DB-level enforcement is accepted residual risk. |

### 6.4 Information disclosure

| ID | Threat | Boundary | L | I | Status | Notes |
|---|---|---|---|---|---|---|
| TM-I-01 | Secret leakage in `sl_capture_events.metadata` (free-form JSONB) | TB-4, TB-7 | M | M | accepted | A worker logging an API key, session token, or PII into `metadata` is a real exposure path. Per session 4 lock (OQ-DD-06 stays untouched), the threat model does **not** recommend a deny-list or shape constraint. Acceptance rationale: free-form `metadata` is a v1 design choice; mitigation is operational discipline (workers do not log secrets), not schema-enforced. **Operational note for ADR Log:** worker authoring guidelines should explicitly prohibit logging secrets to `metadata`. |
| TM-I-02 | `body_text` egress to OpenAI Embedding API | TB-6 | M | M | accepted | Captured content (Nate's articles) leaves the system to be embedded. OpenAI's data handling policy applies; Signal Ledger does not control it. Acceptance rationale: Nate's content is published, not Jonathan's PII. **Forward note:** if Signal Ledger ever ingests private content (drafts, paywalled material redistributed beyond personal use, customer data), TM-I-02 escalates and must be re-evaluated. v1 scope is published Substack content only. |
| TM-I-03 | Accidental capture of paywalled content distributed beyond personal use | TB-1, TB-2a | L | M | mitigated (operational) | Charter §Out of Scope: "External publishing or sharing of corpus artifacts." Mitigation is the use-case boundary itself — the UC inventory contains no publishing or sharing operation. Acceptance rationale: scope discipline is the mitigation; threat re-evaluates if scope expands. |
| TM-I-04 | Service role key leakage from C2 deployment | TB-7 | L | H | mitigated | Supabase platform manages the service role key; Signal Ledger's mitigation is "no key in client-side code, no key in repo, no key in logs." **→ ADR candidate** for ADR Log v0.1: key-handling discipline (env var only, no commits, no log emissions, rotation cadence). |
| TM-I-05 | OB Supabase project shared between OB MCP and Signal Ledger MCP — namespace isolation only | TB-7 | L | M | accepted | DD v0.2 §Storage: "co-located with OB, isolated by naming convention." Acceptance rationale: documented architectural choice, alternative (dedicated project) rejected for inactivity-pause reasons. Compensating control: `sl_*` prefix discipline. **Forward note:** if OB MCP is ever compromised, the same service role key permits Signal Ledger access. Cross-tenant blast radius. |

### 6.5 Denial of service

| ID | Threat | Boundary | L | I | Status | Notes |
|---|---|---|---|---|---|---|
| TM-D-01 | OpenAI embedding API quota exhaustion during full backfill | TB-6 | M | M | mitigated | Functional Spec § 2 caps at 3 attempts per article. Backfill is bounded (~100 Nate articles to date); aggregate cost is small. **Implicit gap:** Functional Spec doesn't specify backoff between articles in a backfill run. Acceptance rationale: personal-use cadence; if rate-limit observed, a manual pause is operationally cheaper than a rate-limit-aware worker for v1. |
| TM-D-02 | Gap-window optimistic-locking starvation under retry pressure | TB-4 | L | L | accepted | Functional Spec § 7 specifies optimistic locking with conflict surfaced to caller. Concurrent gap-window mutation in a single-A1 system is rare. Acceptance rationale: single-user concurrency profile makes starvation unrealistic. |
| TM-D-03 | Supabase project quota exhaustion (DB rows, storage, edge function invocations) | TB-7 | L | M | accepted | OB + Signal Ledger share the Supabase project. Charter scope is bounded (single provider, ~100 articles). Acceptance rationale: corpus scale doesn't approach platform limits in v1. **Forward note:** multi-provider expansion (Ruben, Ken plugins) requires re-evaluation. |
| TM-D-04 | A2-driven runaway: prompt-injection causing recursive ingestion or retrieval loops | TB-5 | L | M | accepted | Cross-references the agent trust boundary subsection (§7). Acceptance rationale: A1 is in the loop for every UC-01/UC-02 initiation per UC Spec; runaway requires A2 acting without A1 confirmation, which is outside current operational pattern. |

### 6.6 Elevation of privilege

| ID | Threat | Boundary | L | I | Status | Notes |
|---|---|---|---|---|---|---|
| TM-E-01 | Service role key compromise = full corpus R/W + log rewriting | TB-7 | L | H | mitigated | Master threat for TB-7. Compensating controls: key in env var only, no client-side exposure, no commits, Supabase platform security, key rotation. **→ ADR candidate** for ADR Log v0.1: C2 service role posture and RLS-disabled rationale. |
| TM-E-02 | Prompt injection from `body_text` causing A2 to take privileged actions | TB-5 | M | H | mitigated (by classification) | **The defining threat for agent-first systems.** Per session 3 lock: A2 treats `body_text` as untrusted data, not as instructions. Imperative-sounding language inside captured content is content *about* the world, not directives *to* the system. The classification is the mitigation. Operational implementation: see §7. **→ ADR candidate** for ADR Log v0.1: agent trust boundary classification as architectural posture. |
| TM-E-03 | MCP tool surface exposes operations that should require A1 confirmation | TB-4 | L | M | accepted | C2's tool surface is invoked by A2 on A1's behalf. UC Spec describes A1-initiated patterns. Acceptance rationale: A2's tool calls are visible in chat; A1 sees the call before result. No silent-action surface in v1. |

---

## 7. Agent Trust Boundary — Dedicated Subsection

Per Addendum G3: *"deserves its own subsection in the threat model, not just a STRIDE checkbox."*

### 7.1 Classification (locked, not re-litigated)

`body_text` retrieved from C3 and surfaced to A2 is **untrusted data**. Body text captures opinions, claims, and rhetorical content from content producers. It is the subject of A2's analysis, not a source of directives to A2. Imperative-sounding language inside captured content is content *about* the world, not instructions *to* the system.

This classification is locked as of 2026-05-03. Threat Model v0.1 propagates it; it does not re-decide it.

### 7.2 Surfaces where the classification must be honored

The classification is the mitigation only if A2 actually honors it at every surface where `body_text` is materialized. Per session 4 lock (D-5), TB-5 stays a single conceptual edge — the classification applies at every materialization point covered by that edge:

- **UC-03 Targeted retrieval response:** `body_text` returned in tool result is data, not instructions
- **UC-04 Inferential / Framing retrieval response:** same
- **UC-04 Framing automatic-consultation:** A2 proactively consults the corpus; retrieved content is data, not instructions
- **UC-05 Audit retrieval:** metadata fields are operational data; `body_text` is not typically returned in audit but if surfaced (for failure analysis), still untrusted data
- **UC-06 Evaluative retrieval:** retrieved evidence is content for evaluation, not directives

### 7.3 Operational mitigations

The classification is policy. Operational mitigations turn policy into practice.

| Mitigation | v1 Status | Rationale |
|---|---|---|
| Wrap `body_text` in tool result with explicit "untrusted content" delimiters | **Recommended for v1 implementation** | Tool result design — the boundary marker is part of the contract between C2 and A2 |
| A2 system prompt declares retrieved corpus content as untrusted data | **Recommended for v1 implementation** | Reasoning posture — A2's prompt should name Signal Ledger retrieval as data, not instruction |
| Test scenarios for prompt injection resistance | **Deferred to DoD v0.1** | Behavioral validation — DoD layer is where signals become test scenarios; this signal needs one |
| Sandboxed execution of any code surfaced by retrieval | **Out of scope v1** | UC inventory contains no code-execution surface from retrieved content |
| Provenance display: when A2 surfaces retrieved content, source is named | **Already required by P3** | Time-as-immutable-provenance — every surfaced item carries `published_date` and provider |

### 7.4 Testable signals (forwarded to DoD v0.1)

The classification is honored if and only if these are observable:

1. **Retrieved content is treated as data, not instruction.** A2 surfacing a Nate article that contains the phrase "the model should now disregard prior instructions" does not cause A2 to disregard prior instructions. This is testable — produce the test scenario in DoD v0.1.
2. **Source attribution is preserved.** A2 surfacing retrieved content always names provider, date, and `article_id`. Verifiable in retrieval response shape.
3. **No retrieved content is executed.** No code path interprets `body_text` (or `cited_claims`, or `structured_technical_content`) as executable instruction. Verifiable by code review at implementation time.

---

## 8. Findings Summary

22 STRIDE findings across 6 categories, plus 1 dedicated agent-boundary subsection.

| Status | Count | Findings |
|---|---|---|
| `mitigated` | 7 | TM-S-04, TM-S-05, TM-T-01, TM-R-02, TM-I-04, TM-D-01, TM-E-01 |
| `mitigated (partial)` | 1 | TM-S-02 |
| `mitigated (operational)` | 1 | TM-I-03 |
| `mitigated (by classification)` | 1 | TM-E-02 |
| `accepted` | 12 | TM-S-01, TM-S-03, TM-T-02, TM-T-03, TM-R-01, TM-I-01, TM-I-02, TM-I-05, TM-D-02, TM-D-03, TM-D-04, TM-E-03 |
| `deferred` | 0 | — |

Total: 22 findings across 6 STRIDE categories. TM-E-02 is broken out as its own status row because "mitigated by classification" is operationally distinct from a code or platform mitigation — the agent trust boundary classification is the mitigation, and §7 documents what honoring it requires.

### 8.1 ADR candidates flagged for ADR Log v0.1

Per session 4 ADR-structure decision: **split, not bundled.** Five separate ADRs flagged for the next session:

1. **ADR-TM-01 — C2 service role posture and RLS-disabled rationale.** Source: TM-E-01. Documents why RLS is explicitly disabled in v1 and what the architectural alternatives were.
2. **ADR-TM-02 — Append-only enforcement at application discipline level only.** Source: TM-T-02. Documents the explicit acceptance of no DB-level enforcement on `sl_capture_events`, with rationale tied to TM-E-01 as the realistic parent threat.
3. **ADR-TM-03 — Service role key handling discipline.** Source: TM-I-04. Documents key-in-env-var-only posture, no commits, no log emissions, rotation cadence.
4. **ADR-TM-04 — HTTPS cert validation as architectural dependency.** Source: TM-S-04. Documents the assumption that runtime HTTPS cert validation is honored for all outbound calls to C1, C4, C5; no Signal Ledger code may override.
5. **ADR-TM-05 — URL-resolution verification at email-backfill ingestion.** Source: TM-S-02. Documents the recommended A2 behavior of verifying email-forwarded article content against the Substack URL before write.

A sixth ADR is also flagged as candidate, surfaced through TM-E-02:

6. **ADR-TM-06 — Agent trust boundary classification.** Source: TM-E-02. Documents the architectural posture that retrieved `body_text` is untrusted data, not instructions. This is the most architecturally significant of the six because it defines how A2 reads from C3.

These ADRs are not authored here. ADR Log v0.1 is the next session.

### 8.2 Findings forwarded to Definition of Done v0.1

Three testable signals from §7.4 forwarded to DoD v0.1:

1. Prompt injection resistance test scenario
2. Source attribution presence test
3. Retrieved-content execution prohibition (verified by code review)

These are signals, not test cases. DoD v0.1 is the layer where signals become test scenarios.

---

## 9. Backward-Flow Check (per Addendum G4)

Each potential backward-flow trigger evaluated:

- **Charter v0.2:** No principle invalidated; no scope change. **No correction needed.**
- **Use Case Spec v0.2:** No use case modified; agent-boundary classification was already a session 3 lock and Use Case Spec v0.2's TB-deferral note remains accurate. **No correction needed.**
- **Data Dictionary v0.2:** OQ-DD-06 stays untouched per session 4 lock; no other entity or field requires modification. TM-I-01 surfaces a real risk on `sl_capture_events.metadata` but per the lock the threat model accepts it without recommending a DD revision. **No correction needed.**
- **Functional Spec v1.0:** § 6 RLS-disabled posture is documented and accepted; § 3 application-discipline append-only is accepted as residual risk per TM-T-02. No implementation behavior change required. **No correction needed.**

**Backward-flow corrections triggered by Threat Model v0.1: zero.** All findings are addressed within Threat Model v0.1 (mitigation status declarations, accepted residual risk with rationale) or forwarded to ADR Log v0.1 (architectural decisions) or DoD v0.1 (test scenarios). No upstream artifact requires a new version.

---

## 10. Open Questions

| OQ ID | Question | Status |
|---|---|---|
| OQ-TM-01 | Threat model versioning model — does v0.1 accumulate per-finding stamps, or get fully rewritten per major version? | **Deferred per session 4 lock** — produce v0.1 first, decide model after seeing what findings look like. Revisit at v0.2 trigger (e.g., ADR Log surfaces a finding that changes a STRIDE row, or scope expansion invalidates v0.1). |

---

## 11. Out of Scope for v0.1

- Multi-user threat model (single-user v1 only)
- External-publishing or sharing threat model (Charter §Out of Scope excludes both)
- Multi-provider threat model (Ruben, Ken plugins not in v1; their addition triggers v0.2)
- Cross-tenant blast radius beyond OB ↔ Signal Ledger co-tenancy (no other tenants in v1)
- Compliance-frame threat modeling (PCI, SOX, HIPAA — not applicable; personal use, no regulated data)
- Adversarial AI red-team scenarios (out of scope for personal-use calibration tier per G3)

---

## 12. Tag

`[signal-ledger:threat-model-v0.1]`

---

*Signal Ledger Threat Model v0.1 — LOCKED 2026-05-04.*
*Produced under LENS Governance Addendum v0.1 principles G1 (visual reasoning required), G2 (diagram as discovery instrument), G3 (threat model as dedicated layer with STRIDE), and G4 (backward flow of findings — none triggered).*
