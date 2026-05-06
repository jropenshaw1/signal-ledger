# LENS Governance — Visual Reasoning & Threat Modeling Addendum v0.1

**Status:** LOCKED — 2026-05-03
**Author:** Claude
**Reviewed and locked by:** Jonathan
**Applies to:** All projects governed by the LENS chain
**Supersedes:** None — this is an additive governance layer

---

## Origin

This addendum exists because of a defect-discovery pattern observed during SignalLedger v0.1. The locked LENS chain (Charter → Use Case Spec → Data Dictionary → Functional Spec) was complete and consistent on its own terms, yet producing a structural diagram after the fact surfaced two missing entities (`sl_capture_events`, `sl_signpost_embeddings`), a spec drift between Data Dictionary and Functional Spec, and an under-specified worker invocation model.

The lesson: **prose hides ambiguity that visual representations expose.** Different modalities of representation catch different defects. A LENS chain composed entirely of prose artifacts is structurally vulnerable to a class of defects that prose cannot surface.

This addendum incorporates visual reasoning and adversarial threat modeling as required disciplines, placed at their highest-yield points in the LENS chain.

---

## Principle G1 — Visual Reasoning Is a Required Modality, Not an Optional Output

Every LENS layer that defines structure, relationships, or execution must produce a corresponding visual artifact at lock time. The visual artifact is not a downstream documentation activity. It is the forcing function that stress-tests the prose specification by demanding concreteness in a different modality.

**Distributed placement, not batched gate.** Each diagram type is required at the LENS layer where it has the highest diagnostic value, not batched into a pre-code checkpoint. Batching delays defect detection to the latest possible moment; distributed placement catches defects at the layer where they originated, when correction is cheapest.

**Required visual artifacts by layer:**

| LENS Layer | Required Visual | Catches |
|---|---|---|
| Charter | Decision flow (which use case for which question) | Missing or overlapping use cases |
| Use Case Spec | Structural diagram (actors, components, data flows) | Component gaps, ambiguous boundaries |
| Data Dictionary | Entity-relationship diagram with cardinality | Missing entities, FK ambiguity, orphan tables |
| Data Dictionary | State-machine diagram per entity with lifecycle | Missing states, illegal transitions |
| Functional Spec | Sequence diagram per critical flow | Race conditions, missing events, ordering ambiguity |
| Functional Spec | Process flow for happy path + each failure mode | Unhandled branches, retry chain defects |
| Threat Model | Trust boundary diagram | Implicit trust assumptions, unenumerated boundaries |
| ADR Log | None required — ADRs are textual by nature | — |
| DoD | Test scenario diagrams for each behavioral signal | Untestable acceptance criteria |

**Locking rule:** A LENS layer cannot be marked LOCKED until its required visual artifacts exist and have been reviewed for consistency with the prose. If the diagram contradicts the prose, the layer is not locked — the contradiction must be resolved first.

**Tool agnosticism:** The diagram type matters; the tool does not. SVG, mermaid, draw.io, hand-drawn-and-photographed, Claude-generated — any medium that produces a reviewable artifact qualifies. The discipline is the diagram, not the production method.

---

## Principle G2 — Diagrams Are Discovery Instruments, Not Documentation

The purpose of the diagram is to *find defects*, not to *document the design*. This distinction governs how diagrams are produced and reviewed.

**A diagram that perfectly matches the prose has not done its job.** The diagram should produce at least one of:
- A question the prose did not answer
- A relationship the prose did not specify
- A transition the prose did not name
- An entity that exists in the diagram but cannot be located in the prose, or vice versa

If the diagram surfaces nothing, the diagrammer is reproducing the prose rather than stress-testing it. Re-do the diagram with fresh eyes, or have a different actor produce it.

**Inconsistencies are findings, not errors.** When diagram and prose disagree, both modalities have been produced honestly; the inconsistency reveals an ambiguity in the underlying decision. Resolution may go any of three directions: update the diagram, update the prose, or update both to match a clarified third position. The wrong move is to silently align the diagram to the prose without examining what the disagreement was telling you.

**Polish is anti-pattern at the discovery stage.** A rough diagram that surfaces a defect outperforms a polished diagram that doesn't. Diagrams produced for portfolio or stakeholder consumption are a separate output that follows discovery, not a substitute for it.

---

## Principle G3 — Security Is Its Own Layer, Not a Section of Another

Threat modeling becomes a dedicated LENS layer (Layer 5), placed between Functional Spec lock and ADR Log start. It is not folded into ADR Log, not appended to Functional Spec, not deferred to a security review pass.

**Rationale:** Architectural decision records and threat models answer different questions and produce different artifacts.
- ADRs answer *why did we choose X*. They are a record of decisions made.
- Threat models answer *what attacks did we consider, which did we mitigate, and which did we accept as residual risk*. They are a record of defenses considered.

Collapsing the two loses the second question. The second question is the one that gets surfaced at audit time, at incident response time, and during retroactive accountability reviews. It deserves its own artifact.

**STRIDE as default framework:** Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege. Other frameworks (PASTA, LINDDUN, attack trees) are acceptable substitutes when the project context calls for them, but STRIDE is the default and requires no justification to use.

**Calibration by exposure:**

| Exposure | STRIDE Application | Time Budget |
|---|---|---|
| Personal, single-user, no public surface | Light — one pass, focus on injection and data integrity | 30–60 minutes |
| Personal but agent-readable (corpus consumed by AI) | Medium — explicit attention to prompt injection and trust boundaries between captured content and agent reasoning | 1–2 hours |
| Multi-user or shared resource | Rigorous — full STRIDE on every trust boundary | Half-day minimum |
| Multi-tenant, public surface, or PII | Mandatory full STRIDE; document compensating controls for each unmitigated finding | Day or more, with formal review |

**Required output:**
- One artifact per project: `lens-threat-model-vN.md`
- Trust boundary diagram (per G1) enumerating every point where data crosses from less-trusted to more-trusted context
- For each STRIDE category: identified threats, likelihood, impact, mitigation status (mitigated, accepted, deferred)
- Findings producing architectural changes generate ADR entries
- Findings accepted as residual risk are documented with explicit rationale — accepting risk silently is not an option

**Trust boundary discipline for agent-first systems:** Captured content read back to a reasoning agent is a trust boundary. The threat model must declare explicitly whether the agent treats retrieved content as trusted instructions or untrusted data. Implicit trust is a defect.

---

## Principle G4 — Backward Flow of Findings

When a diagram, threat model, or any downstream artifact surfaces a defect, the finding flows backward to the layer where the defect originated. It is not patched in place at the current layer.

**Origin of this principle:** Eighteen years of operational experience at Avnet, where developer culture preferred patch-in-place over upstream correction. Issues fixed downstream bit repeatedly because the upstream artifact still expressed the original defect, and any work derived from it inherited the same flaw. The CI/CD pipeline was implemented in part to enforce backward correction by making it the cheaper path at the moment of decision. The principle generalizes beyond code: spec drift, design drift, and threat coverage gaps all follow the same pattern. The correct answer is almost always the most difficult, and the role of governance is to make the difficult correct answer the path of least resistance.

**Operational rule:** When a finding requires updating an upstream layer, the upstream layer is updated to a new version, and all downstream layers are re-validated for consistency. The re-validation is required, not optional. In practice the re-validation is usually small — most findings are clarifications, not structural shifts — but the discipline of doing it prevents drift from compounding.

**Worked example (SignalLedger):** The structural diagram surfaced `sl_capture_events` as an entity referenced in Functional Spec but absent from Data Dictionary. The patch is *not* to add the entity inline in Functional Spec. The patch is to update Data Dictionary to v0.2, restoring chain consistency. Functional Spec is then re-validated against the updated Data Dictionary and re-locked if needed.

**Anti-pattern to watch for:** "It's already locked, let's just note it inline and move on." This is exactly the patch-in-place failure mode the principle exists to prevent. The lock is on the artifact at a version, not on the truth — and when the truth changes, the artifact gets a new version. Locks are not immutability; they are commitment-at-a-point-in-time.

---

## Updated LENS Chain Order

The LENS chain order is updated to incorporate visual reasoning and threat modeling at their native layers:

1. **Charter** — purpose, scope, principles, success criteria
   - Required visual: decision flow for retrieval modes or use case routing
2. **Use Case Spec** — actors, use cases, sub-modes, dependencies
   - Required visual: structural diagram showing actors, components, data flows
3. **Data Dictionary** — entities, fields, types, validation rules
   - Required visuals: ER diagram with cardinality; state-machine per entity with lifecycle
4. **Functional Spec** — execution semantics, transactions, error handling, sequencing
   - Required visuals: sequence diagram per critical flow; process flow for happy and failure paths
5. **Threat Model (NEW — Layer 5)** — STRIDE-calibrated adversarial analysis
   - Required visual: trust boundary diagram
   - Required output: threat model document with mitigation status per finding
6. **ADR Log** — architectural decisions with rationale, including those generated by threat findings
7. **Definition of Done** — test plan derived from Charter behavioral signals
   - Required visuals: test scenario diagrams for each behavioral signal

Total layers: 7 (was 6).

---

## Retroactive Application

This addendum applies to:
- **All future projects** — full compliance from Charter forward
- **In-flight projects past the layer where an artifact would be added** — produce the artifact at the next layer touch; accept that earlier defects may surface late and trigger backward-flow corrections per G4
- **Locked projects with no active development** — no retroactive obligation; the addendum applies if the project is reopened

**SignalLedger v0.1 specifically:** Currently between Functional Spec (locked) and ADR Log (pending). Backward-flow corrections required: Data Dictionary v0.2 to add E7 and E8 entities surfaced by structural diagram; ER diagram and state-machine diagrams produced as part of Data Dictionary v0.2 lock; threat model produced before ADR Log start.

---

## Out of Scope for This Addendum

- Tool-specific guidance (which diagramming tool to use)
- Visual style standards (palette, typography, layout conventions)
- Mandatory templates for individual artifact formats
- Test-plan-before-code discipline (related but separate; addressed in a future governance addendum if adopted)

---

## Open Questions

| OQ ID | Question | Status |
|---|---|---|
| OQ-GOV-01 | Should Charter-level decision flow be required, or only recommended? Charter is the only layer where the visual yield may be lower than the production cost. | **Open** — defer to first project that locks Charter under v0.1 governance; revisit after evidence |
| OQ-GOV-02 | Threat model versioning — does it accumulate stamps like prompt kit evaluations, or get fully rewritten per version? | **Open** — likely accumulating per finding, fully rewritten per major version; defer to first threat model produced |
| OQ-GOV-03 | Visual artifact storage — embedded in markdown spec, separate file, or both? | **Open** — pending decision on render-time tooling |

---

## Tag

`[lens-governance:addendum-v0.1]`

---

*LENS Governance Addendum v0.1 — LOCKED 2026-05-03.*
