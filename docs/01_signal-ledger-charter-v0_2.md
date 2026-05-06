# Signal Ledger — Charter
**LENS Chain Position:** Layer 1 of 7
**Status:** LOCKED — 2026-05-03
**Version:** v0.2
**Date:** 2026-05-03
**Author:** Claude (sole writer, v1)
**Supersedes:** Charter v0.1 (LOCKED 2026-04-29)

---

## Changes from v0.1

This version is a targeted consistency pass. Substantive scope, principles, and behavioral signals are unchanged.

| Change | Reason |
|---|---|
| Retrieval Modes section consolidated from six modes to **five modes with one sub-mode** (Framing collapsed as sub-mode of Inferential) | Use Case Spec v0.1 already treats Inferential/Framing as a single use case (UC-04) with sub-mode dispatch. Charter v0.1 prose said "Five retrieval modes" but enumerated six. v0.2 aligns Charter to Use Case Spec. Surfaced during LENS Governance Addendum v0.1 retrofit per principle G4 (backward flow of findings). |
| Behavioral signal 3 reframed | Signal 3 now tests the Framing **sub-mode** behavior of Inferential retrieval, not a separate mode. Substance of the test is unchanged; the framing is consistent with the Retrieval Modes section. |
| LENS chain position updated to "Layer 1 of 7" | LENS Governance Addendum v0.1 added Threat Model as Layer 5. |
| Governance Notes — LENS chain order updated | Reflects 7-layer chain per addendum. |
| Tag updated to `[signal-ledger:charter-v0.2]` | New version, new tag per handoff convention. |

No principles changed. No scope changed. No What Done Looks Like criteria changed.

---

## Purpose

Signal Ledger is a personal content intelligence system. It captures, preserves, and retrieves articles from a curated set of content providers — beginning with Nate B. Jones — in a form that serves two distinct jobs simultaneously.

**Job 1 — Trajectory-preserving reference library.** Knowledge work in a volatile-technology environment requires a durable reference layer that tracks not just what experts said, but how their thinking has evolved. Signal Ledger preserves captured articles as immutable point-in-time artifacts. The delta between a February perspective and an April perspective on the same topic is itself a unit of insight. Older perspectives do not become wrong or stale — they become historical data in a trajectory. The system is the record of that trajectory, not a maintenance layer for current truth.

**Job 2 — Subscription decision support.** Content providers are evaluated the same way AI platforms are: against a finite budget, on the basis of track record, with upgrade and renewal decisions driven by evidence rather than impression. Signal Ledger accumulates that evidence over time and makes it retrievable as a coherent body of work per provider. Jonathan deciding whether a provider earns continued spend is a first-class use case, not an afterthought.

The same corpus serves both jobs. The retrieval intent differs; the underlying system is one.

---

## Scope

### V1 Delivery Scope

**Provider:** Nate B. Jones (Substack). Single provider for v1. Multi-provider architecture is validated in v1; additional providers ship in subsequent versions.

**Coverage:** Full backfill of all published Nate B. Jones articles from Jonathan's subscription start (February 12, 2026) through current date, plus ongoing capture going forward.

**Gap window:** The MCP server index begins on February 22, 2026. Articles from February 12–21 (10 articles, confirmed) must be sourced from email backfill. These articles are in-scope for v1 delivery; the email-backfill ingestion path is the designated route.

**Content types in scope for v1:**
- `Nate-feature-article` — full thought pieces, complete capture
- `Nate-executive-briefing` — weekly strategic briefings, full capture (effective April 29, 2026, following Jonathan's upgrade to executive tier)

**Prompt kit capture:** All prompt kits linked from Nate articles are captured and bound to their parent articles. Prompt kit lifecycle tracking is a v1 deliverable.

**Provider record:** A dated provider record for Nate is populated in v1, including evaluation criteria, tier history, and engagement signals.

### What Is Not V1 Scope

See the Out of Scope section.

---

## Architectural Principles

**P1 — Library framing.** Articles are books on the shelf — durable, immutable, citeable, dated. The summary layer exists alongside the source content, not in place of it. Both are stored: the full source artifact (preserved verbatim) and structured representations (searchable, agent-consumable). Neither substitutes for the other.

**P2 — Agent-first, human-second.** Signal Ledger is built for AI consumption. Humans access it through agents. No human-browsing UI is required or planned. Chunking, metadata design, and retrieval architecture are optimized for agent utility, not human reading experience.

**P3 — Time as immutable provenance.** Every captured artifact carries its timestamp as a first-class field alongside source and author. This is non-negotiable. Captured articles are never edited to reflect new understanding. They are point-in-time captures, permanently dated.

**P4 — Trajectory preservation, not current-truth maintenance.** The system preserves the evolution of thinking over time. Contradiction across time is data, not a bug — it is never auto-flagged, never auto-reconciled, and never suppressed. The system has no opinion about which take was right.

**P5 — Cultivation over accumulation.** The corpus is tended. Artifacts are re-tagged, refined, and enriched as understanding deepens. Partial captures are superseded when access expands (the free-to-paid upgrade pattern is the canonical example). Write-once accumulation is explicitly wrong.

**P6 — Three-level plugin architecture: source → content-type → plugin spec.** A single source can produce multiple content types, each requiring a distinct plugin. The plugin spec lives at the intersection of source and content type. Examples confirmed in scope: `Nate-feature-article`, `Nate-executive-briefing`. Plugin authoring for additional sources (Ruben Dominguez, Ken Huang) follows the same pattern; their plugins do not ship in v1 but the architecture is validated against them.

**P7 — Author signposts as privileged extraction targets.** When an author provides their own structured overview — their own table of contents, their own statement of implications, their own flag for novel insight — the ingestion layer extracts along those seams rather than re-summarizing. The author already did the hard part. Signal Ledger preserves it verbatim.

**P8 — Cited claims and structured technical content as first-class artifacts.** Embedded examples, statistics, code blocks, schemas, and attributed citations have independent retrieval value separate from the prose containing them. They are captured as discrete sub-entries with their own dated provenance, attached to but retrievable independently from the parent article.

**P9 — Source-vs-system honesty.** The system maintains a clear distinction between content the source did not provide (free-tier truncation, missing kits, access-gated material) and content the system failed to capture (extraction failures, corruption, pipeline gaps). Anti-fabrication discipline is a first-class requirement at the audit layer.

**P10 — Provider records as first-class entities.** Providers are not metadata fields on articles. They have their own dated records with evaluation criteria, tier history, engagement signals, and value assessments over time. Provider-level trajectory is maintained in the same way article-level trajectory is maintained.

**P11 — Failure data is forward-looking infrastructure.** Failure logs are the early-warning system for upstream drift. When a provider changes their platform, when extraction patterns break, when coverage gaps appear — the failure record is the signal. Not operational noise to be cleared; forward intelligence to be acted on.

**P12 — Ingestion-source agnosticism.** The captured article artifact is the unit of value. How it entered the system — MCP API, email, HTML scrape, manual entry — is provenance metadata on the artifact, not its identity. Retrieval, cultivation, and evaluation logic operate on artifacts, not ingestion methods. This principle holds as ingestion paths multiply.

### Mutable Artifact Carve-Out

The principles above describe an immutable capture system. One named exception exists: **prompt kit lifecycle records are the only mutable artifacts in Signal Ledger.** They accumulate run history and evaluation evidence over time rather than representing a point-in-time capture. This exception is deliberate and bounded. All other artifacts remain immutable.

The lifecycle record accumulates via evaluation stamps. When Jonathan executes or evaluates a prompt kit, a dated stamp is written to the record. Each stamp carries: date of evaluation, execution context, and repeat disposition — one of: one-time (kit served a bounded purpose and will not be re-run, e.g. initial corpus population), repeat-scheduled (run again at a specified date or trigger), conditionally-deferred (run again when a named condition is met), or unevaluated (kit has been captured but not yet assessed). Repeat disposition is logged as a timestamped array, preserving the history of Jonathan's evaluation posture over time.

---

## Content Type and Capture Completeness

Content type names the structural shape of the artifact. Capture completeness names how much of it was obtained. These are separate concerns.

**Capture completeness values:**
- `complete` — full content captured as published
- `preview-only` — content was truncated at source (e.g., executive briefings captured under a free-tier subscription before April 29, 2026); flagged, not treated as pipeline failure
- `partial` — system captured less than the full artifact due to extraction failure or interruption; treated as incomplete, retry warranted

Historical `Nate-executive-briefing` captures made before April 29, 2026 carry `capture_completeness: preview-only`. This reflects source access at the time of capture, not system failure.

---

## Retrieval Modes

Five retrieval modes are first-class. All five must function in v1. Inferential carries one named sub-mode (Framing); the sub-mode shares actor flow, corpus, and query surface with Inferential and is dispatched at query time.

**Targeted.** Precision lookup against a specific question. "Nate on transactions versus credentials" returns the matching content directly.

**Inferential.** Broader semantic surfacing during adjacent project work, and rhetorical-pattern analysis across the corpus. The agent proactively surfaces relevant captures while Jonathan drafts or builds — with the delta between perspectives noted where it exists. Two sub-modes are dispatched within Inferential:

- **Inferential (default).** What Nate argues or concludes across time. Draws on `cited_claims` and `body_text`. The conclusion, not the lens.
- **Framing (sub-mode).** How Nate constructs an argument rhetorically. The lens, not the conclusion. Draws on `author_signposts` and `structured_technical_content`. Also covers automatic corpus consultation when project context triggers relevance — the agent checks before responding, not after.

Sub-mode ambiguity is resolved by the agent via clarifying question before query execution. The user may declare sub-mode explicitly.

**Audit.** Ingestion integrity. "What Nate articles do I have between subscription start and today; which have prompt kits; any gaps; any duplicates" returns a clean answer with a date-and-title manifest. Coverage detection is heuristic, not deterministic — the system surfaces candidates for human verification; the human resolves whether a missing date is a gap or a no-publication day.

**Evaluative.** Provider-level trajectory and evidence to support subscription decisions. "Show me Ken Huang's body of captured work, organized so I can judge whether his contribution justifies the spend."

**Kit Status.** Prompt kit inventory filtered by evaluation state. "Which kits have I not yet executed or evaluated" is the canonical query. Returns kits by lifecycle status: unevaluated, executed-one-time, repeat-scheduled, or conditionally deferred. This mode is the operational surface for prompt kit lifecycle management.

---

## What Good Looks Like

Five behavioral signals. All five must pass for the system to be working.

1. **Inferential retrieval working.** Claude proactively surfaces three relevant Nate perspectives from different months while Jonathan drafts a piece, with the delta between them noted.

2. **Targeted retrieval working.** "What's the trajectory of thinking on multi-agent coordination over the last 90 days" returns coherent synthesis pulled from the corpus with source dates.

3. **Framing sub-mode working.** Working on a project with AI-governance signal triggers automatic corpus consultation under the Framing sub-mode of Inferential; the agent checks before responding, drawing on `author_signposts` and `structured_technical_content` rather than conclusion-level claims.

4. **Audit retrieval working.** "What Nate articles do I have between subscription start and today; which have prompt kits; any gaps; any duplicates" returns a clean, accurate answer.

5. **Ingestion validation working.** For every detected article, content is verifiably captured and cataloged. For every prompt kit referenced, the kit is verifiably extracted and bound to its parent. For every detected capture failure, a retry was attempted and failure details are recorded.

---

## What Done Looks Like for V1

**Capture completeness:**
- Full backfill of all Nate B. Jones articles from February 12, 2026 through current date, including the February 12–21 gap window sourced from email backfill.
- Linked prompt kits captured and bound to their parent articles.
- Prompt kit lifecycle records initialized for all captured kits.
- Provider record for Nate populated with tier history and Jonathan's April 2026 evaluation criteria.

**Quality validation:**
- All five behavioral signals from What Good Looks Like pass.
- Per-article extraction validated: title, date, author signposts (overview, implications, contrarian flag), cited claims and incidents, commercial context, full source artifact preserved verbatim, linked kits attached.
- Audit layer can produce a coverage report that correctly distinguishes source-not-provided from system-failed-to-capture.

**Architecture validation:**
- Three-level plugin pattern implemented and validated against both Nate content types (`Nate-feature-article`, `Nate-executive-briefing`).
- Architecture proven extensible: plugin authoring guide produced such that Ruben and Ken plugins could be authored without revisiting core architecture.
- Two ingestion paths (MCP-primary, email-backfill) both operational and producing equivalent artifact quality.

**Operational validation:**
- Pipeline identifies missing dates and surfaces them for human verification.
- Pipeline detects corrupted or incomplete captures, retries, and records failure details.
- Cultivation pattern proven with at least one example of a captured artifact being enriched or superseded after initial capture.

---

## Out of Scope

The following are explicitly not being built in v1. Named here because each was considered.

- Human-browsing UI of any kind (no card catalog, no reading view, no table of contents)
- Write-once accumulation (corpus is cultivated, not appended-and-forgotten)
- Single-source-locked design (multi-source architecture is in scope; additional provider plugins are not)
- Summary-replaces-source compression (full source artifacts always preserved alongside structured representations)
- Current-truth maintenance (no editing of captured artifacts to reflect new information)
- Automated contradiction reconciliation across time
- Single-shape content assumption (different content types require different plugins; plugin authoring is explicit, not automated)
- Generic summarization independent of author signposts
- Automated engagement signal capture (manual acceptable for v1)
- Provider comparison dashboards (deferred until multi-source data exists)
- Automated upgrade recommendations (deferred until usage data exists)
- Ruben Dominguez (`The AI Corner`) plugin — architecture validated, plugin not shipped
- Ken Huang (`Agentic AI`) plugin — architecture validated, plugin not shipped
- Plugin auto-detection (new source/content-type pairs require explicit plugin authoring)
- Contradiction detection across the corpus

---

## Governance Notes

**Project context:** Signal Ledger is Jonathan's first agent-first production system. The project — including its LENS governance chain, architectural decisions, and build process — is being documented as a professional portfolio artifact.

**LENS chain order (per Governance Addendum v0.1):** Charter → Use Case Spec → Data Dictionary → Functional Spec → Threat Model → ADR Log → Definition of Done. Each layer gates the next. Threat Model added as Layer 5 by Governance Addendum v0.1 (LOCKED 2026-05-03).

**Single-writer governance:** Claude is the sole writer of all LENS artifacts in v1. Round-table contributions from Gee and Grok are synthesized by Claude and incorporated as decisions, not as co-authored text.

**ADR Log:** Six architectural decisions from the predecessor nate-archiver project (Q1–Q6) are carried forward as retrospective ADR entries after Threat Model lock. Decisions that do not survive Charter scrutiny are adjusted with provenance intact.

**Existing technical assets:** `recon.py`, `recon_report.json`, `manifest.json`, and the build-ready architecture spec (OB: 54547b27) are inputs to the Functional Spec and ADR Log, not this Charter. They are not discarded; they are evaluated after Charter lock.

**Decision flow visual (OQ-GOV-01):** Deferred. Charter-level decision flow diagram is currently optional under Governance Addendum v0.1. Revisit after evidence accumulates from projects locked under v0.1 governance.

---

## Tag

`[signal-ledger:charter-v0.2]`

---

*Signal Ledger Charter v0.2 — LOCKED 2026-05-03. Supersedes v0.1.*
