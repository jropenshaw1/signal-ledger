# Signal Ledger — ADR Log v0.1

**Status:** LOCKED — 2026-05-05
**Version:** v0.1
**LENS Chain Position:** Layer 6 of 7
**Depends On:** Charter v0.2 (LOCKED 2026-05-03), Use Case Spec v0.2 (LOCKED 2026-05-03), Data Dictionary v0.2 (LOCKED 2026-05-03), Functional Spec v1.0 (LOCKED 2026-05-01), Threat Model v0.1 (LOCKED 2026-05-04)
**Precedes:** Definition of Done v0.1 (NOT STARTED)
**Governance:** LENS Governance Addendum v0.1 (LOCKED 2026-05-03)
**Author:** Claude (sole writer, v1)

---

## 1. Purpose

The ADR Log records *why* Signal Ledger looks the way it does. Each entry captures one significant architectural decision: the context that drove it, the alternatives that were considered and rejected, the decision itself, and the consequences that follow. Threat Model v0.1 records what attacks were considered and which were accepted as residual risk. The ADR Log records the design decisions — some traceable to threat findings, some traceable to predecessor work, some surfaced through operational reality.

ADRs are immutable once ratified. Superseding decisions create new ADRs; they do not modify existing ones. This convention is locked under LENS Governance Addendum v0.1.

## 2. Format

Each ADR follows the Michael Nygard format:

- **Status** — proposed, accepted, superseded, deprecated
- **Date** — YYYY-MM-DD of the decision
- **Source** — what surfaced this decision (threat finding, carry-forward, operational reality)
- **Context** — the situation requiring a decision
- **Decision** — what was decided
- **Alternatives Considered** — what was rejected, and why
- **Consequences** — what follows from the decision, including downstream artifact implications

## 3. Scope of v0.1

ADR Log v0.1 contains 13 entries grouped in three sets:

**Set A — Threat-model-derived (ADR-001 through ADR-006).** Six ADRs flagged by Threat Model v0.1 §8.1 as architectural decisions that warrant standalone records. Per session 4 lock, these are split rather than bundled.

**Set B — Predecessor carry-forward (ADR-007 through ADR-012).** Six retrospective ADRs documenting architecture decisions made in the predecessor nate-archiver project (Q1–Q6). Per Charter v0.2 Governance Notes, these decisions were locked before Signal Ledger's LENS governance chain existed; carrying them forward as retrospective ADRs preserves provenance and exposes them to Charter scrutiny. Decisions that do not survive Charter scrutiny are adjusted in place with rationale.

**Set C — Operational-reality finding (ADR-013).** One ADR surfaced during the Session 4-to-5 transition. Identified through operational reality (rate-limit notice on the Executive Circle MCP setup page after Jonathan's executive-tier upgrade) rather than threat modeling. Folded into the current LENS layer per principle G4 backward-flow rather than deferred.

## 4. Numbering Convention

ADR numbers are zero-padded three-digit identifiers (ADR-001 through ADR-013 for v0.1). Sequence reflects logical grouping, not chronological surfacing. Threat-model-derived ADRs lead because they are the most architecturally consequential set; carry-forward ADRs follow because they record predecessor reasoning; the operational-reality ADR comes last because it was surfaced during this layer rather than during prior LENS work.

Numbers are stable across versions. New ADRs are appended; superseded ADRs retain their number with status updated.

---

# Set A — Threat-Model-Derived ADRs

---

## ADR-001 — C2 Service Role Posture and RLS-Disabled Rationale

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Threat Model v0.1 TM-E-01 (Elevation of privilege — service role key compromise = full corpus R/W + log rewriting)

### Context

Signal Ledger's MCP edge function (C2) authenticates to the Postgres backend (C3) using the Supabase service role key. Functional Spec v1.0 §6 documents that Row Level Security (RLS) is explicitly disabled on the `sl_*` tables. Threat Model v0.1 D-3 surfaced this as an internal-but-consequential boundary (TB-7): the mitigation against unauthorized C3 access is operational discipline, not platform-enforced isolation.

The decision predates the threat model — it was implicit in the choice to co-locate Signal Ledger with OpenBrain in a single Supabase project. The threat model surfaced the need for the decision to be explicit.

### Decision

C2 authenticates to C3 using the service role key. RLS is disabled on all `sl_*` tables for v1. The mitigation against unauthorized access is the service role key staying secret (see ADR-003).

### Alternatives Considered

**RLS-enabled with per-table policies.** Rejected for v1 on three grounds. First, Signal Ledger is a single-user system — there is no second principal whose access RLS would constrain. Second, OpenBrain co-tenancy uses the same service-role posture; introducing RLS for `sl_*` while OB tables remain RLS-disabled would create asymmetric posture in a single Supabase project. Third, RLS adds query-shape constraints that complicate the embedding worker's read path without commensurate threat-model benefit at v1 scale. Reconsidered if Signal Ledger ever serves a second principal.

**Dedicated Supabase project for Signal Ledger.** Rejected for inactivity-pause reasons documented in DD v0.2 §Storage. Free-tier projects pause after periods of inactivity; co-locating with OB ensures Signal Ledger benefits from OB's continuous activity. Dedicated project remains the v1.5+ option if multi-tenancy concerns escalate.

**Anon-key auth with selective RLS.** Rejected because the embedding worker requires `body_text` read access across all articles to compute hashes and detect content drift; anon-key auth with per-row permission would require constructing policies whose net effect equals service-role access, which is equivalent posture at higher operational cost.

### Consequences

- C2 is the only legitimate writer to `sl_*` tables; any other writer constitutes a service-role-key compromise (TM-E-01).
- Service role key handling is the master mitigation for TB-7. ADR-003 records that handling discipline.
- OB ↔ Signal Ledger co-tenancy is a documented architectural choice. The cross-tenant blast radius noted in TM-I-05 is accepted: an OB MCP compromise grants Signal Ledger access via the same service-role key.
- Multi-tenant or multi-user scope expansion invalidates this ADR and triggers a v0.2 reconsideration. RLS-enabled posture is the pre-baked v1.5+ alternative if and when scope changes.
- Functional Spec v1.0 §6 is the canonical implementation reference; this ADR records the rationale, not the mechanics.

---

## ADR-002 — Append-Only Enforcement at Application Discipline Level Only

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Threat Model v0.1 TM-T-02 (Tampering — `sl_capture_events` log forgery / after-the-fact tampering)

### Context

Functional Spec v1.0 §3 declares `sl_capture_events` append-only. Threat Model v0.1 TM-T-02 surfaced that this declaration is enforced at the application layer only. Postgres permits UPDATE and DELETE on the table at the database level. A service-role-key compromise (TM-E-01) defeats application-discipline append-only because the compromised credentials grant full mutation rights.

The threat model accepted this residual risk with reasoning that requires standalone documentation in the ADR Log.

### Decision

`sl_capture_events` is append-only by application discipline. No DB-level policy or trigger preventing UPDATE or DELETE is implemented in v1. The compensating control is service-role-key secrecy per ADR-003.

### Alternatives Considered

**DB-level policy preventing UPDATE/DELETE on `sl_capture_events`.** Rejected because it does not add defense against the realistic parent threat (TM-E-01). A service-role-key compromise can drop or alter the policy itself before tampering with the table; DB-level enforcement defeats only attackers who hold writer credentials but lack policy-modification rights. Under the service-role-key auth posture (ADR-001), no such intermediate-privilege actor exists. The defense would protect against a threat model that is not Signal Ledger's threat model.

**Append-only via INSERT-only role with separate read role.** Rejected because the embedding worker and the audit retrieval mode both require read access to `sl_capture_events`; splitting writer and reader credentials produces operational complexity without additive defense for the same reason as the above.

**Cryptographic event-chain (each event signed with hash-of-prior-event).** Considered and deferred. Detects tampering after the fact but does not prevent it; would require a separate verification pass not in v1 scope. v1.5+ option if audit-trail integrity becomes a regulatory or evidentiary concern. Personal-use single-user scope does not warrant the engineering cost.

### Consequences

- `sl_capture_events` integrity in v1 reduces to service-role-key integrity (ADR-003). The two ADRs are not independent defenses; they are a single defense recorded at two layers.
- Application-discipline append-only is sufficient for the threat model's calibration (medium STRIDE per Addendum G3, single-user, personal-use). It is not sufficient for evidentiary use, regulatory audit, or multi-principal trust scenarios. Scope expansion that introduces those concerns invalidates this ADR.
- Audit retrieval (UC-05) treats `sl_capture_events` rows as authoritative within the trust posture documented above. The audit response is not a tamper-evident record; it is an application-trusted record.
- TM-T-02 status is `accepted`; this ADR is the documented rationale.

---

## ADR-003 — Service Role Key Handling Discipline

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Threat Model v0.1 TM-I-04 (Information disclosure — service role key leakage from C2 deployment)

### Context

The service role key is the master credential for Signal Ledger's `sl_*` tables (ADR-001) and the compensating control for application-discipline append-only (ADR-002). Its secrecy is load-bearing for the entire C3 trust posture. Threat Model v0.1 TM-I-04 surfaced four leakage paths: client-side exposure, repo commits, log emissions, and rotation lapse. Each requires explicit handling discipline.

### Decision

Service role key handling discipline for v1:

1. **Storage:** environment variable only, scoped to the Supabase Edge Function deployment environment. Never written to disk in any persistent form outside that environment.
2. **Repository:** never committed. `.env` files containing the key are gitignored; pre-commit secret-scanning is recommended but not gated.
3. **Logs:** never emitted to any log surface. C2 worker code does not log full request headers, environment dumps, or any structured object that would serialize the key. `sl_capture_events.metadata` (free-form JSONB) is explicitly prohibited from carrying the key per the operational note in TM-I-01.
4. **Client-side exposure:** C2's edge function URL is the only client-facing endpoint. The key is not exposed in any client-side code path. A2 calls C2 by tool invocation, not by direct DB access.
5. **Rotation cadence:** rotated on credential-exposure suspicion or at least annually. Rotation is a manual operational task; v1 does not implement automated rotation.

### Alternatives Considered

**Per-environment key scoping (dev / prod separate keys).** Rejected for v1 single-deployment scope. The Edge Function deployment is the only environment that needs the key; introducing per-environment keys adds rotation complexity without commensurate benefit. v1.5+ option if a staging environment is introduced.

**Vault-based key storage (HashiCorp Vault, AWS Secrets Manager, Doppler).** Rejected for v1 cost-and-complexity reasons. Supabase platform secrets management is the operating environment; introducing a second secrets layer adds attack surface without removing the original. Supabase secrets are the trust anchor regardless of whether a vault wraps them.

**Automated rotation with overlap window.** Considered and deferred to v1.5+. Manual rotation is sufficient for personal-use cadence; automated rotation requires a second deployment surface (rotation worker) whose own credentials would need handling.

### Consequences

- TM-I-04 status is `mitigated` on the strength of this discipline.
- Worker authoring guidelines (referenced in TM-I-01 operational note) explicitly prohibit logging secrets to `sl_capture_events.metadata`. This ADR is the authority that worker authoring guidelines reference.
- Discipline failure invalidates ADR-001 and ADR-002 simultaneously. Key compromise is the master threat (TM-E-01); both upstream ADRs depend on this one.
- Rotation events should be logged in `sl_capture_events` (operational metadata, not the key itself) so the audit retrieval mode can surface rotation history if asked.
- Forward note: if Signal Ledger ever exposes a second client surface (web UI, mobile, third-party access), this ADR requires revision because client-side-exposure assumptions change.

---

## ADR-004 — HTTPS Cert Validation as Architectural Dependency

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Threat Model v0.1 TM-S-04 / D-4 (Spoofing — MCP server endpoint impersonation; Discovery — implicit cert-validation assumption not surfaced in any prior artifact)

### Context

Signal Ledger makes outbound HTTPS calls to three semi-trusted external services: C1 (Executive Circle MCP), C4 (Gmail MCP), and C5 (OpenAI Embedding API). Threat Model v0.1 D-4 surfaced that no prior LENS artifact documented the dependency on HTTPS certificate validation being honored at the runtime layer. The mitigation against endpoint impersonation (TM-S-04) is implicit in the runtime's TLS stack; making the dependency explicit prevents future code changes from quietly disabling the protection.

### Decision

Signal Ledger code may not disable HTTPS certificate validation under any circumstance. The runtime's default TLS posture — full chain validation, hostname verification, current root store — is an architectural dependency. No `verify=False`, `rejectUnauthorized: false`, `--insecure` flag, custom HTTP client without cert validation, or equivalent override is permitted in any code path that calls C1, C4, or C5.

This applies to:
- Production code (C2 Edge Function and embedding worker)
- Test code that simulates production calls
- Local development scripts that hit production endpoints
- Any future C2 worker added before this ADR is superseded

### Alternatives Considered

**Cert pinning per endpoint (pinned certificate for C1, C4, C5).** Considered and rejected for v1. Cert pinning provides stronger defense than chain validation but requires rotation handling for each pinned endpoint. C1, C4, and C5 are managed services whose certs rotate on schedules outside Signal Ledger's control; pinning would introduce operational fragility (broken ingestion on cert rotation) for a threat (compromised CA) that is outside the v1 calibration tier.

**Mutual TLS (mTLS) with client certificates.** Rejected because none of C1, C4, C5 require or support client-cert auth in their public APIs. Service-level auth is API-key or OAuth-token based; mTLS would not displace the existing auth mechanism.

**No declared posture (status quo).** Rejected because D-4 explicitly identified the implicit assumption as the gap.

### Consequences

- Code review for any new outbound HTTP call must verify cert validation is on by default. No exemption process; the ADR has no carve-outs.
- Local development against staging or sandbox endpoints uses real HTTPS with valid certs. Self-signed cert use (which would require disabling validation) is not a permitted shortcut.
- TM-S-04 status is `mitigated` on the strength of this declaration.
- Forward note: this ADR applies to all outbound HTTPS, not only to C1, C4, C5. New external dependencies inherit the discipline automatically.
- A future ADR may introduce cert pinning for high-value endpoints if the threat model recalibrates upward. v0.1 does not.

---

## ADR-005 — URL-Resolution Verification at Email-Backfill Ingestion

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Threat Model v0.1 TM-S-02 (Spoofing — email forgery; spoofed sender forwards an article that wasn't published by Nate)

### Context

Charter v0.2 §Scope identifies the February 12–21 gap window (10 articles) as in-scope for v1, sourced via email backfill. Threat Model v0.1 TM-S-02 surfaced that the email-backfill ingestion path (TB-2a) is partially mitigated against forgery by Gmail's SPF/DKIM/DMARC at the inbox level, but forwarded mail breaks DKIM, and any sender Jonathan whitelisted can submit content claiming to be from Nate. The threat model recommended an additional content-canonicalization step: A2 verifies the article's URL against Substack metadata before write.

### Decision

For every email-backfill ingestion, A2 performs URL-resolution verification before writing to `sl_articles`:

1. Email body must contain a Substack URL pointing to the article being ingested.
2. A2 fetches the URL via C1 (Executive Circle MCP) or via direct HTTPS GET.
3. The fetched article's `published_date` and `title` must match the email's claimed values within tolerance (exact `published_date`, fuzzy-match `title`).
4. The fetched article's `body_text` is the canonical version written to storage. The email's body content is treated as a reference signal, not as the source of truth.
5. If verification fails (URL doesn't resolve, content doesn't match, no Substack URL present), the ingestion is refused. A `sl_capture_events` row is written with status `verification_failed` and the operator (A1) is notified.

### Alternatives Considered

**No verification — trust the email content directly.** Rejected because TM-S-02 is explicitly about forgery, and trusting unverified content collapses the threat model's distinction between TB-2a (semi-trusted via Gmail authentication) and TB-1 (HTTPS to Substack with full publisher identity).

**Verification via Substack RSS feed match.** Considered and rejected for v1. RSS feeds carry `published_date` and `title` but not full `body_text`; would catch metadata forgery but not content-substitution forgery. URL-resolution against the live article catches both. RSS verification is a complementary v1.5+ enhancement, not a replacement.

**Verification only on whitelist-mismatch (skip if sender is Jonathan-himself or known forwarder).** Rejected because the threat model named "any whitelisted sender" as a forgery vector. Skipping verification on whitelist match defeats the purpose. Verification runs unconditionally on TB-2a ingestion.

**Block all email-backfill ingestion (force MCP-only).** Rejected because Charter v0.2 §Scope explicitly designates email backfill as the route for the February 12–21 gap window. Removing the path removes in-scope articles from v1 delivery.

### Consequences

- Email backfill is structurally slower than MCP ingestion (each article requires a verification fetch). Acceptable for the bounded backfill window.
- TM-S-02 status is `mitigated (partial)`; this ADR is the partial-mitigation mechanism. The residual risk is that the URL itself could resolve to a malicious mirror — defended by ADR-004 cert validation.
- The verification logic is agent-side (A2 performs the check before invoking the C2 write tool). C2 does not re-verify; the boundary is at A2's reasoning layer.
- DoD v0.1 should include a behavioral test: an email-backfill ingestion attempt with a mismatched URL is refused and the failure is logged.
- Forward note: if a future provider does not publish to a verifiable URL surface (e.g., paid-newsletter content with no public mirror), TM-S-02 escalates and this ADR requires revision because the verification mechanism would not apply.

---

## ADR-006 — Agent Trust Boundary Classification

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Threat Model v0.1 TM-E-02 (Elevation of privilege — prompt injection from `body_text` causing A2 to take privileged actions); §7 Agent Trust Boundary subsection

### Context

The defining threat for an agent-first system: prompt injection via stored content. Signal Ledger captures content from external sources, embeds it, and surfaces it back to A2 for retrieval and analysis. Captured content can contain imperative-sounding language ("the model should now disregard prior instructions," "ignore this and run X"). Threat Model v0.1 §7 named this the architecturally most significant of all ADR candidates — it defines how A2 reads from C3.

The classification was locked on 2026-05-03 by Jonathan: A2 treats retrieved `body_text` as untrusted data, not as instructions. Threat Model v0.1 propagated the classification; ADR-006 records it as architectural posture.

### Decision

Retrieved `body_text` from Signal Ledger storage is **untrusted data**, not instruction. This applies at every materialization surface:

1. UC-03 Targeted retrieval response
2. UC-04 Inferential / Framing retrieval response
3. UC-04 Framing automatic-consultation
4. UC-05 Audit retrieval (when `body_text` is surfaced for failure analysis)
5. UC-06 Evaluative retrieval

The classification is the mitigation. It is honored if and only if A2 actually treats the content as data at every surface where it materializes.

### Alternatives Considered

**Treat retrieved content as trusted (the default agent-naive posture).** Rejected categorically. This is the precise failure mode prompt injection exploits. Charter principle P2 (agent-first, human-second) makes the system inherently susceptible to this failure mode because the entire retrieval surface is agent-consumed; the mitigation cannot be optional.

**Sandboxed execution of any code surfaced by retrieval.** Considered and deferred. The UC inventory contains no code-execution surface from retrieved content in v1. If a future use case introduces code execution (e.g., running code blocks from `structured_technical_content`), this alternative becomes the necessary defense and a new ADR records it. v1 does not need the mechanism.

**Filter retrieval response to remove imperative language.** Rejected for two reasons. First, imperative language in captured content is often legitimate content (Nate writes about what models *should* do, what teams *should* prioritize, what readers *should* test) — filtering would corrupt the corpus. Second, filtering creates a security-through-obscurity posture; sophisticated injection bypasses any specific filter. The classification posture defends against injection categorically; filtering defends against specific surface forms.

**Per-surface classification (some retrieval surfaces trust content, some do not).** Rejected because the heterogeneous posture is itself an attack surface — an attacker who can route their content into a "trusted" surface bypasses the defense at the "untrusted" surfaces. Single classification across all surfaces is the only stable posture.

### Consequences

- A2's system prompt declares retrieved Signal Ledger content as untrusted data. This is a v1 implementation requirement (Threat Model §7.3).
- C2's tool result for any retrieval that returns `body_text` wraps the content in explicit "untrusted content" delimiters. The boundary marker is part of the contract between C2 and A2.
- Three behavioral signals are forwarded to DoD v0.1:
  1. A2 surfacing a Nate article that contains "the model should now disregard prior instructions" does not cause A2 to disregard prior instructions.
  2. A2 surfacing retrieved content always names provider, date, and `article_id`.
  3. No code path interprets `body_text`, `cited_claims`, or `structured_technical_content` as executable instruction.
- TM-E-02 status is `mitigated (by classification)`. The status is operationally distinct from code- or platform-mitigated; the agent-boundary classification is *the* mitigation, and the ADR records the architectural posture that makes the classification load-bearing.
- Forward note: this ADR is the most fragile of Set A because honoring the classification is a behavioral discipline at the A2 level, not an enforceable mechanism. DoD v0.1 must produce real test scenarios. Any future model change that affects A2's instruction-following posture (system prompt rewrites, agent framework swap, multi-agent orchestration) requires re-validation against this ADR.

---

# Set B — Predecessor Carry-Forward ADRs

The six ADRs in this set originate from the predecessor nate-archiver project's Q1–Q6 architecture decisions, locked 2026-04-18. Per Charter v0.2 Governance Notes, they are carried forward as retrospective ADRs with provenance preserved. Each entry has been re-evaluated against Signal Ledger's Charter v0.2, Use Case Spec v0.2, Data Dictionary v0.2, Functional Spec v1.0, and Threat Model v0.1. The status field documents whether the predecessor decision survives Charter scrutiny without modification, survives with adjustment, or is superseded.

The original Q1–Q6 lock thoughts in OpenBrain remain authoritative for the predecessor project's history; this set is the Signal Ledger record of which decisions still apply and on what terms.

---

## ADR-007 — Dispatcher Shape (Predecessor Q1: Lightweight Registry)

**Status:** Accepted with adjustment
**Date:** 2026-04-18 (predecessor lock); 2026-05-05 (carry-forward to Signal Ledger)
**Source:** nate-archiver Q1 lock (OB: 13d467c7-fa28-4ed7-a688-3b3d483c86db)

### Context

The predecessor nate-archiver project required a dispatcher to route extraction work across multiple handler types (`promptkit_natebjones`, `notion_page`, future Google Docs / Beehiiv / GitHub Gist). The Q1 decision selected a lightweight registry over an `if/elif` chain. The decision pre-dated Signal Ledger's three-level plugin architecture (P6).

### Decision

Handler dispatch uses a `HANDLERS: dict[str, Handler]` registry keyed by classification bucket. The `Handler` Protocol defines the interface. Initial registrations in v1: `"promptkit_natebjones": PromptKitHandler()`, `"notion_page": NotionHandler()`.

**Adjustment for Signal Ledger:** The dispatcher pattern carries forward as the implementation mechanism for plugin dispatch under P6 (three-level plugin architecture). Plugin entities (per DD v0.2 Plugin entity) are the Charter-level abstraction; the registry is the implementation. Plugin authoring populates the registry; plugin auto-detection remains explicitly out of scope per Charter §Out of Scope.

### Alternatives Considered (predecessor decision)

**`if/elif` chain on classification bucket.** Rejected at predecessor lock because the Protocol forces explicit interface definition, and handler #3 was not hypothetical. Confirmed at carry-forward: P6 makes the rejection stronger — the plugin architecture *requires* explicit interface contracts.

### Alternatives Reconsidered at Carry-Forward

**Plugin entities as DB rows with handler reference (full registry-in-DB pattern).** Considered. Rejected for v1 because it adds a deployment-time hot-load surface that exceeds the v1 use-case profile (Jonathan-controlled single-writer plugin authoring per Charter §Governance Notes). Plugin entities in DD v0.2 capture plugin metadata; the runtime registry stays in code. v1.5+ option if dynamic plugin loading becomes a need.

### Consequences

- `models.py`, `handlers/base.py`, and `handlers/*.py` carry forward from the predecessor build-ready spec (OB: 54547b27).
- The Plugin entity in DD v0.2 is the metadata layer; the registry is the runtime layer. They reference each other by `plugin_id`.
- Adding a new content type (e.g., when Ruben or Ken plugins are authored) requires registry entry + Plugin row; both are required, neither alone is sufficient.

---

## ADR-008 — Loader / Extractor Split (Predecessor Q2: Separate Loader Layer)

**Status:** Accepted with adjustment
**Date:** 2026-04-18 (predecessor lock); 2026-05-05 (carry-forward to Signal Ledger)
**Source:** nate-archiver Q2 lock (OB: 13d467c7-fa28-4ed7-a688-3b3d483c86db)

### Context

The predecessor project separated queue construction (loader) from networked extraction (extractor). The split was rationalized as decoupling deterministic offline work from networked work with failure modes. Skip rules and slugification were placed in the loader.

### Decision

Loader and extractor are separate layers with a JSON queue artifact between them. Data flow: `manifest.json + recon_report.json → loader → extraction_queue.json → extractor → prompt_kits/*.md + manifest.prompt_kits`. The loader is deterministic, offline, fast; the extractor is networked, slow, has failure modes.

**Adjustment for Signal Ledger:** The split survives unchanged for prompt kit extraction. For article ingestion (the new Signal Ledger surface that the predecessor did not cover), the same shape applies: a queue construction step distinct from the networked fetch step. The queue artifact is a Signal Ledger schema (likely an `ingestion_queue` table or in-memory equivalent within C2), not a JSON file on disk, because article ingestion runs inside C2's Edge Function context where filesystem is ephemeral.

### Alternatives Considered (predecessor decision)

**Single-pass extractor with skip rules inline.** Rejected at predecessor lock because skip-rule logic embedded in the networked path complicates retry semantics. Confirmed at carry-forward.

### Alternatives Reconsidered at Carry-Forward

**Use C2's `sl_capture_events` as the queue surface (event-sourced queue).** Considered. Compelling because it consolidates state. Deferred — `sl_capture_events` carries operational events (ingestion attempts, failures, completions) but using it as a work queue mixes audit data with operational state. The split survives; the in-memory queue inside C2 is an implementation detail that does not surface in DD v0.2.

### Consequences

- Skip rules and slugification stay in the loader layer for prompt kits; equivalent pre-fetch validation stays at the C2 ingestion entry point for articles.
- The atomic-write idiom (tmp + fsync + os.replace) carries forward from `recon.py` for any disk-persistent loader output.
- `extraction_queue.json` shape from the predecessor build-ready spec carries forward for prompt kits unchanged.

---

## ADR-009 — Retry and Pacing Discipline (Predecessor Q3: Two-Exception Pattern, Minimal Pacing)

**Status:** Accepted with adjustment
**Date:** 2026-04-18 (predecessor lock); 2026-05-05 (carry-forward to Signal Ledger)
**Source:** nate-archiver Q3 lock (OB: 3e9c9353-4168-4150-89d5-47bbdaefe710)

### Context

The predecessor project locked a two-exception retry pattern (`RetryableError` → 1 retry / `UnrecoverableError` → fail) with 500ms inter-call pacing. Rationale was volume-based (1/day average, max ~7/week) and prioritized maintainability over defensive engineering.

### Decision

Handler-level error classification:
- `RetryableError` for rate limits and transient network failures → main loop catches, sleeps `RETRY_SLEEP_SEC`, retries once. Second failure marks entry failed.
- `UnrecoverableError` for parse failures, 404s, auth walls → mark failed immediately.

Pacing: single `INTER_CALL_DELAY_SEC` constant between dispatches. No per-handler overrides, no exponential backoff, no adaptive logic.

**Config constants (one file, three knobs):** `INTER_CALL_DELAY_SEC = 0.5`, `RETRY_SLEEP_SEC = 5.0`, `MAX_RETRIES = 1`.

**Adjustment for Signal Ledger:** The pattern survives for prompt kit extraction. For article ingestion in C2, retry is bounded at the embedding worker by Functional Spec v1.0 §2 (3 attempts per article); the worker's retry semantics are a separate spec, not a re-implementation of the predecessor pattern. The two-exception classification carries forward as a code idiom: any new C2 worker uses the same `RetryableError` / `UnrecoverableError` distinction.

The pacing constant does not carry forward unmodified — see ADR-013, which addresses upstream rate-limit governance at a different layer (source adapter rather than per-call pacing constant).

### Alternatives Considered (predecessor decision)

Per-handler retry counters, per-bucket pacing dicts, adaptive backoff, exception taxonomy beyond two-class — all rejected as anti-patterns at predecessor volume. Confirmed at carry-forward for prompt kit extraction.

### Alternatives Reconsidered at Carry-Forward

**Exponential backoff for embedding API rate-limit responses.** Considered. Functional Spec v1.0 §2 caps at 3 attempts; whether those attempts are evenly spaced or backoff-spaced is an implementation choice deferred to the embedding worker's spec, not promoted to ADR-level. v1 ships with linear retry; backoff is a v1.5+ refinement if observed rate-limit pressure warrants.

### Consequences

- Prompt kit extractor inherits the predecessor pattern unchanged.
- C2 workers (embedding, ingestion) inherit the two-exception classification idiom but tune retry counts and pacing per Functional Spec v1.0 specifications.
- ADR-013 supersedes the pacing portion for upstream rate-limited sources; this ADR remains authoritative for handler-level error classification.

---

## ADR-010 — Filename Collision Handling (Predecessor Q4: Auto-Suffix with Loud Log)

**Status:** Accepted with adjustment
**Date:** 2026-04-18 (predecessor lock); 2026-05-05 (carry-forward to Signal Ledger)
**Source:** nate-archiver Q4 lock (OB: 73348930-34cb-4a61-8cb3-0f424ca0d4d4)

### Context

The predecessor project addressed filename collisions and resumption safety as three orthogonal axes (detection / resolution / resumption). Auto-suffix with stderr + log warning was selected as single-mode resolution. File-existence cross-check on resumption was selected as default-safe behavior.

### Decision

**Collision detection** (loader-level, always active): scan queue for duplicate `kit_file` values; cross-check each entry's `kit_file` against existing `manifest.prompt_kits` records. Collision = different `gmail_message_id`, same `kit_file`.

**Collision resolution** (auto-suffix with loud log, single mode): append `_<gmail_id_short>` (last 8 chars of `gmail_message_id`). Stderr warning + run-log entry. No CLI flags, no operator intervention required.

**Resumption safety** (file-existence cross-check, warn + re-extract on desync): verify `Path(entry.kit_file).exists()` for every `manifest.prompt_kits` entry with `status=success`. On file-missing-but-manifest-says-success, warn on stderr, re-add to queue, re-extract.

**Adjustment for Signal Ledger:** The pattern applies unchanged to prompt kit extraction. For article ingestion, "filename collision" does not apply — articles are stored in C3 with `article_id` as primary key; the analog is `article_id` collision detection, which DD v0.2 handles via UNIQUE constraint at the schema level (different mechanism, same goal). The predecessor pattern is preserved here for the prompt kit surface; article-level uniqueness is a DD concern, not an ADR concern.

### Alternatives Considered (predecessor decision)

CLI flag-based collision resolution (`--resolve-collisions=auto|suffix:<id>|skip:<id>`) — rejected at predecessor lock as YAGNI for the volume profile. Confirmed at carry-forward.

### Alternatives Reconsidered at Carry-Forward

None. The predecessor decision is volume-bounded and the volume hasn't changed for prompt kit extraction. Article-level uniqueness is handled at a different layer (DD UNIQUE constraint), not by reapplying this pattern.

### Consequences

- Prompt kit collision and resumption-safety logic carries forward from the predecessor build-ready spec (OB: 54547b27) unchanged.
- Re-extract on file-missing-manifest-says-success is the default; it does not require a CLI flag. The audit retrieval mode (UC-05) surfaces these re-extract events from `sl_capture_events`.
- If lifetime collision count ever exceeds zero, this ADR is revisited. Current expectation is zero-collision-lifetime per the predecessor cadence analysis.

---

## ADR-011 — Write Timing (Predecessor Q5/Q6: Batch All Writes at End of Run)

**Status:** Superseded by C2 architecture
**Date:** 2026-04-18 (predecessor lock); 2026-05-05 (carry-forward analysis)
**Source:** nate-archiver Q5/Q6 lock (OB: 62b0a541-b1cc-4c12-b4ff-a7e745f8a11c)

### Context

The predecessor project locked unified end-of-run write timing across three targets: markdown files, manifest, and OpenBrain commits. Rationale was avoidance of OB-says-done / manifest-says-pending desync. End-of-run ordering: files first (atomic each), then manifest, then per-kit OB commits.

### Decision

**Predecessor decision:** End-of-run batch writes with atomic file writes, single atomic manifest update, per-kit OB commits.

**Status at carry-forward: SUPERSEDED for Signal Ledger article ingestion.** Signal Ledger writes through C2 to C3 directly; there is no manifest-on-disk artifact and no OB commit step in the article ingestion flow. The predecessor's "unified write timing" question doesn't translate — Signal Ledger has one write target (C3) and one durability mechanism (Postgres ACID).

**Status for prompt kit extraction: ACCEPTED unchanged.** The predecessor decision applies as-is to the prompt kit extractor, which still writes to disk + manifest.

### Alternatives Considered (predecessor decision)

Per-kit two-phase commit across OB + manifest (rejected as YAGNI). Split posture per write target (rejected for desync risk per claude.ai Claude's flag). Intermediate checkpoints / WAL-style journaling (rejected as infrastructure for a scale not present). Confirmed at carry-forward for the prompt kit surface.

### Alternatives Reconsidered at Carry-Forward

**Two-phase commit between C2 article write and OB notification.** Considered for Signal Ledger article ingestion. Rejected because Signal Ledger's design treats C3 as the sole durable record; OB is not a co-equal write target for article state. The predecessor pattern presumed two equal-priority write targets; Signal Ledger's architecture eliminates the second target.

### Consequences

- Prompt kit extractor inherits the end-of-run batch pattern from the predecessor build-ready spec (OB: 54547b27).
- Signal Ledger article ingestion uses Postgres transactional semantics — no additional write-timing protocol needed. Functional Spec v1.0 §3 specifies the actual transaction boundaries.
- This ADR is the documented superseding event: the predecessor decision applies to prompt kit work but not to article ingestion. Future readers of the predecessor Q5/Q6 lock thoughts are referred to this ADR for the carry-forward disposition.
- If a future Signal Ledger surface introduces a second co-equal durable target (e.g., a search index alongside C3), the predecessor pattern is the candidate to reconsider, and a new ADR records the decision. v1 has only C3.

---

## ADR-012 — Manifest Authority and Crash Recovery (Predecessor companion to Q5/Q6)

**Status:** Accepted (prompt kit surface only)
**Date:** 2026-04-18 (predecessor lock); 2026-05-05 (carry-forward to Signal Ledger)
**Source:** nate-archiver Q5/Q6 lock (OB: 62b0a541-b1cc-4c12-b4ff-a7e745f8a11c) — companion decision to write-timing

### Context

The predecessor project's Q5/Q6 lock included a companion decision: `manifest.prompt_kits` is the authoritative source of done-ness. If a kit isn't in `manifest.prompt_kits` with `status=success`, it isn't done. Orphan files on disk are tolerated and auto-cleaned via overwrite on re-extract. Crash recovery story rests on this property.

### Decision

`manifest.prompt_kits` is the authoritative record of prompt kit done-ness. Files on disk without a corresponding success record are orphans; they are not treated as done and are overwritten on re-extract. Atomic file writes prevent half-written-file corruption.

**Crash recovery story:**
- Crash before write phase: nothing written, queue status unchanged, re-run from queue.
- Crash during file writes: partial files on disk, manifest empty, orphans overwritten on re-extract.
- Crash during manifest write: atomic write is all-or-nothing.
- Crash during OB commit phase: per-kit; retry the run; OB-side dedup handles duplicates.

**Adjustment for Signal Ledger:** The pattern applies to the prompt kit surface unchanged. For Signal Ledger article state, the analog authority is `sl_articles` table state in C3, and crash recovery is Postgres transactional. The conceptual rule — *one authoritative source of done-ness, recoverable from a crash without partial-completion ambiguity* — carries forward as a Charter principle adjacent (P9 source-vs-system honesty); the implementation differs.

### Alternatives Considered (predecessor decision)

Two-phase commit across manifest + OB (rejected as YAGNI). Quorum-of-targets done-ness (rejected as overengineering). Confirmed at carry-forward for the prompt kit surface.

### Alternatives Reconsidered at Carry-Forward

**Authority distributed across C3 + OB for article state.** Rejected for Signal Ledger v1: single authority is simpler, and Signal Ledger's design treats C3 as the canonical state bus. OB stores Signal Ledger-related thoughts (handoffs, decisions, this very ADR Log) but does not store article state. No distribution.

### Consequences

- Prompt kit extractor inherits manifest authority unchanged.
- Signal Ledger article state is recovered from C3 alone after any crash. `sl_capture_events` rows surface the recovery semantics for audit retrieval (UC-05).
- The predecessor pattern remains the model for any future Signal Ledger surface that writes to multiple durable targets. The current architecture has only one.

---

# Set C — Operational-Reality ADR

---

## ADR-013 — Rate-Limit Budget Governance for Upstream Content Sources

**Status:** Accepted
**Date:** 2026-05-05
**Source:** Operational reality — Executive Circle MCP setup page surfaced rate-limit specifications after Jonathan's executive-tier upgrade (2026-04-29). Identified as backward-flow finding under LENS principle G4 during the Session 4-to-5 transition (2026-05-05). Captured as ADR candidate in OpenBrain (ID: 6a89a720-cd37-4a2e-9839-15d53191707c) per Jonathan's Option A election.

### Context

Executive Circle MCP, Signal Ledger v1's primary upstream source for Nate B. Jones content, enforces rate limits (120 requests/minute, 2,000 requests/day per the setup page). The constraint was not surfaced in any prior LENS layer because it appears on a setup page that became reachable only after the executive-tier upgrade.

The corpus to be backfilled (full Nate archive from February 12, 2026 through current date, plus prompt kits) requires multiple calls per article (article fetch, signpost extraction, prompt kit fetch). Initial backfill at typical call rates approaches or exceeds the daily budget. Phase 2 sources (Ruben Dominguez, Ken Huang, others) will have their own rate-limit profiles that may differ in shape and magnitude.

The decision is needed at ADR-level rather than implementation-level because the architectural shape of rate-limit governance affects multiple downstream artifacts (Data Dictionary, Functional Spec, Use Case Spec) and must extend cleanly to Phase 2 sources without re-architecture.

### Decision

Rate-limit budget governance lives at the **source-adapter layer**, not the Signal Ledger core. Each adapter owns its rate-limit awareness, persistent budget state, and backoff behavior. Backfill operations are multi-day, resumable, and budget-aware by design.

Specifically:

1. Each source adapter (Executive Circle MCP adapter for v1; future Ruben adapter, Ken adapter for v1.5+) maintains its own per-source rate-limit configuration as data, not code.
2. Adapter call paths consult a persistent budget ledger before each upstream call. If the call would exceed the budget, the adapter pauses or yields control to a multi-day backfill scheduler.
3. Backfill operations are designed for multi-day execution. UC-01 Backfill anticipates resumption across sessions. Per-session work is bounded by budget, not by total corpus size.
4. Cross-adapter coordination is unnecessary. Adapters target independent sources with independent budgets; there is no shared rate-limit pool.

### Alternatives Considered

**Centralized rate-limit governor in Signal Ledger core.** Rejected. Couples adapters to one another. Adds coordination overhead with no benefit when adapters target independent sources. Forces every new adapter to integrate with the central governor at the cost of adapter independence (Charter P6 plugin architecture cleanliness).

**Single-session backfill with manual operator re-run.** Rejected. Exceeds daily budget for the v1 corpus. Brittle on session interruption. Conflicts with the multi-day resumable design implied by Functional Spec v1.0 §3 capture-event semantics.

**Aggressive caching to reduce upstream call count.** Considered as a complementary mechanism, not as a replacement. Caching reduces budget pressure but does not address the architectural question of where governance lives. Adopted as an implementation enhancement at the adapter layer; not promoted to ADR-level.

**Rate-limit-naive ingestion with operator-driven pacing.** Rejected. Operator-driven pacing is what the predecessor Q3 pattern (ADR-009) already provides for the per-call pacing question. ADR-013 addresses a different problem — daily and per-minute budget envelopes that no per-call pacing constant can solve. ADR-009 and ADR-013 are complementary, not competing.

### Consequences

**Downstream artifact implications (this ADR drives revisions in three layers):**

1. **Data Dictionary v0.3 (anticipated):** A new "Upstream Source Properties" section is added documenting per-source rate limits as factual properties of the source, separate from the architectural decision recorded here. The Executive Circle MCP entry includes: 120 requests/minute, 2,000 requests/day, OAuth token auth, content types served (Nate-feature-article, Nate-executive-briefing), endpoint shape, pagination model.

2. **Functional Spec v1.x re-validation:** The behavioral spec for backfill operations is confirmed or extended to include budget-aware multi-day backfill, retry-after-backoff semantics, and persistent budget state. Existing Functional Spec v1.0 §2 retry caps remain valid; what's added is the budget-envelope wrapper around retry behavior.

3. **Use Case Spec v0.x re-validation:** UC-01 Backfill anticipates multi-day operation under budget pressure. The use case description language is updated if necessary to make the multi-day shape explicit.

**Threat Model implications:** None. Threat Model v0.1 already names `RATE_LIMITED` as a recognized error class (DD v0.2 line 360 reference). No Threat Model revision is triggered by this ADR.

**Implementation deferred items (not ADR-level, captured here for traceability):**
- Specific budget-tracking schema (likely an `sl_api_call_ledger` table or equivalent in C3).
- Specific backoff algorithm (exponential, fixed-window, sliding-window).
- Specific persistence mechanism for cross-session budget state.

**Forward note:** This ADR is the first Signal Ledger ADR surfaced through operational reality rather than threat modeling or predecessor work. The capture path — backward-flow finding under G4, folded into the current LENS layer — is itself a governance precedent. Future operational findings during a layer's authoring window are folded forward, not deferred to the next version, when feasible.

---

## 5. Summary

**Total ADRs in v0.1:** 13.

| Set | Count | ADR Range | Provenance |
|---|---|---|---|
| A — Threat-model-derived | 6 | ADR-001 through ADR-006 | Threat Model v0.1 §8.1 |
| B — Predecessor carry-forward | 6 | ADR-007 through ADR-012 | nate-archiver Q1–Q6 (April 2026) |
| C — Operational-reality | 1 | ADR-013 | Executive Circle MCP setup page (April 29, 2026) |

**Status distribution:**

| Status | Count | ADRs |
|---|---|---|
| Accepted | 6 | ADR-001, ADR-002, ADR-003, ADR-004, ADR-005, ADR-006, ADR-013 |
| Accepted with adjustment | 5 | ADR-007, ADR-008, ADR-009, ADR-010, ADR-012 |
| Superseded by C2 architecture | 1 | ADR-011 |

(Counts above sum to 13 because ADR-013 is "Accepted" without adjustment qualifier despite being post-Charter; the "with adjustment" category is reserved for predecessor carry-forwards whose decisions required Charter-fit adjustments.)

## 6. Forwarded to Definition of Done v0.1

Three behavioral test signals from ADR-006 are forwarded to DoD v0.1, joining the three signals already forwarded by Threat Model v0.1 §8.2 (which originated from the same agent-boundary subsection):

1. Prompt injection resistance test scenario.
2. Source attribution presence test.
3. Retrieved-content execution prohibition (verified by code review).

Plus one additional behavioral test signal from ADR-005:

4. Email-backfill ingestion attempt with mismatched URL is refused and the failure is logged.

Plus, indirectly, the operational discipline checks documented across ADR-001, ADR-002, ADR-003, and ADR-004 — these are not behavioral test signals (they are operational invariants) and are appropriate for code-review checkpoints in DoD v0.1, not test scenarios.

## 7. Backward-Flow Check (per Addendum G4)

Each upstream artifact evaluated against ADR Log v0.1 findings:

- **Charter v0.2:** No principle invalidated. The plugin architecture (P6) is consistent with ADR-007's registry implementation and ADR-013's adapter-layer governance. No correction needed.
- **Use Case Spec v0.2:** UC-01 Backfill description language may benefit from explicit multi-day-shape language per ADR-013. Adjustment is candidate-for-v0.3, not blocking. Documented; not triggered.
- **Data Dictionary v0.2:** ADR-013 anticipates a v0.3 Data Dictionary revision adding "Upstream Source Properties" with per-source rate limits. Triggered. To be authored as a Data Dictionary v0.3 task.
- **Functional Spec v1.0:** ADR-013 anticipates a re-validation pass to confirm or extend budget-aware backfill behavior. Triggered. To be addressed as a Functional Spec v1.1 task.
- **Threat Model v0.1:** No correction needed. ADR-013 does not change any STRIDE finding; `RATE_LIMITED` is already recognized.

**Backward-flow corrections triggered by ADR Log v0.1: two.** Data Dictionary v0.3 (Upstream Source Properties section) and Functional Spec v1.1 (budget-aware backfill behavior). Both are scoped, neither is blocking for ADR Log v0.1 lock; they are work items handed forward.

## 8. Resolved at Lock

Three open questions were raised during the draft and resolved by Jonathan at lock 2026-05-05:

| OQ ID | Question | Resolution |
|---|---|---|
| OQ-ADR-01 | Does the carry-forward provenance pattern (ADR-007 through ADR-012) need a separate provenance document, or is the per-ADR Source field sufficient? | **Per-ADR Source field is sufficient.** The predecessor lock thoughts in OpenBrain are the provenance trail; no separate provenance document is created. |
| OQ-ADR-02 | Should ADR-011 (superseded predecessor write-timing decision) be retained in the log, or removed since it's superseded? | **Retained.** The supersession is itself an architectural fact. Removing the entry would lose the trace that the predecessor pattern was considered and explicitly does not apply to article ingestion. |
| OQ-ADR-03 | Is ADR-013 the correct numbering, or should operational-reality ADRs use a separate prefix (e.g., ADR-OR-01)? | **Single ADR-### numbering sequence retained.** The Source field disambiguates origin (threat-model-derived, predecessor carry-forward, operational reality). Split prefixes would add navigation cost without analytical benefit. |

## 9. Out of Scope for v0.1

- ADRs for Functional Spec v1.0 implementation choices that did not surface alternatives (e.g., specific Postgres column types, specific JSON shapes). These are Functional Spec content, not ADR content.
- ADRs for predecessor design choices that did not survive into Signal Ledger (e.g., the original TNEF/IMAP code path that was routed around when Gmail scraping moved outside Python). These are documented in the predecessor OB lock thoughts; resurfacing them here would mistake provenance for relevance.
- ADRs for v1.5+ scope (multi-provider plugin authoring, multi-writer governance via AegisRelay, RLS-enabled posture). These are anticipated by Charter v0.2 §Governance Notes and various forward-notes throughout this log; they are authored when v1.5 scope opens.
- Data Dictionary v0.3 content (Upstream Source Properties section). Triggered by ADR-013; authored as a separate work item.
- Functional Spec v1.1 content (budget-aware backfill behavior). Triggered by ADR-013; authored as a separate work item.

## 10. Tag

`[signal-ledger:adr-log-v0.1]`

---

*Signal Ledger ADR Log v0.1 — LOCKED 2026-05-05.*
*Produced under LENS Governance Addendum v0.1, principles G1 (visual reasoning required where structure is defined — N/A for ADR Log; the Threat Model diagram referenced throughout is the visual artifact), G2 (diagram-as-discovery — applied indirectly via inheritance from Threat Model v0.1), G3 (calibrated rigor — medium tier, single-user personal-use scope), and G4 (backward flow of findings — two corrections triggered, both scoped as forward work items).*
*Set A authored from Threat Model v0.1 §8.1 ADR candidates. Set B authored from nate-archiver Q1–Q6 lock thoughts (OB IDs preserved in each Source field). Set C authored from OpenBrain capture 6a89a720-cd37-4a2e-9839-15d53191707c.*
