# SignalLedger

Most content systems are built for humans to browse. SignalLedger is built for agents to retrieve.

It captures, preserves, and surfaces articles from a curated set of content providers in a form optimized for AI consumption. No reading UI. No card catalog. No folder of markdown files. Humans access the corpus through agents; agents retrieve on demand.

---

## The Problem It Solves

AI implementation and industry evolution are occurring at a velocity that makes traditional content consumption strategies inadequate. Decision points shift daily. The correct answer today is wrong tomorrow — not because the original decision was careless, but because the underlying landscape moved.

The instinct most people follow in response is to consume more: more newsletters, more podcasts, more LinkedIn thought leaders, more breaking announcements from nervous executives managing shareholder expectations. That instinct makes the problem worse. Volume is not signal. A press release is not a trend. An influencer's opinion, however confident, is a point-in-time impression dressed as analysis.

The more useful response is to track fewer sources more rigorously — and to let the record speak over time rather than reacting to any single data point.

SignalLedger is built on a different premise: that immutable, dated, point-in-time captures of curated content, evaluated longitudinally, tell a more actionable story than any individual article or announcement ever could. The goal is not to identify the right answer today. It is to maintain layered, accurate situational awareness across time — knowing where the real shifts are occurring, where to keep watching, and when a development represents a genuine inflection point versus a knee-jerk reaction to short-term noise.

A corpus of dated artifacts, queried by an agent that understands trajectory, is a better strategic instrument than a reading list.

---

## Why It's Built This Way

**The first architectural decision was to delete the content store.**

An earlier prototype accumulated 100+ articles as local markdown files. That approach was abandoned before SignalLedger's first commit. A folder of `.md` files solves for human browsing behavior — scrolling, scanning, opening tabs. It does not solve for agent retrieval, which needs semantic proximity, provenance, and structured metadata. The MCP connection to the content source is the archive. The agent is the interface.

**Immutability as a first principle.** Captured articles are never edited to reflect new understanding. Contradiction across time is data, not a bug. A February perspective and an April perspective on the same topic that disagree with each other is exactly the kind of signal the system is designed to preserve. The system has no opinion about which take was right — that judgment belongs to the human, informed by the full trajectory.

**Cultivation over accumulation.** Every article in the corpus carries a `capture_status` of either `provisional` or `canonical`. A free-tier capture of a paywalled article is provisional — it exists as a placeholder, not as a permanent record. When a complete version becomes available, the provisional record is deleted and the canonical complete version is ingested fresh. Immutability applies to canonical records only. A ledger that grows without being tended is just a stack of invoices waiting to be reconciled.

---

## What It Does

SignalLedger serves two jobs from a single corpus:

**Trajectory-preserving reference library.** Captured articles are immutable point-in-time artifacts. The delta between perspectives across time is itself a unit of insight. The system preserves that evolution — it does not maintain current truth.

**Subscription decision support.** Content providers are evaluated on evidence accumulated over time. Whether a provider earns continued spend is a first-class use case, backed by a structured body of captured work per provider — not impression or habit.

---

## Architecture

- **Storage:** pgvector on Supabase — semantic retrieval via HNSW vector index, structured filtering via B-tree indexes on date, provider, and content type
- **Write path:** Dedicated Signal Ledger MCP (Supabase Edge Function)
- **Retrieval modes:** Targeted, Inferential, Framing, Audit, Evaluative, Kit Status
- **Content model:** Articles, Prompt Kits, Evaluation Stamps, Provider Records — each with independent retrieval value and accumulating provenance
- **Agent:** Claude (sole writer and orchestrator, v1)

---

## Status

**Governance phase — pre-build.**

The LENS governance chain is in progress:

| Layer | Document | Status |
|---|---|---|
| 1 | Charter | Locked v0.1 |
| 2 | Use Case Spec | Locked v0.1 |
| 3 | Data Dictionary | Locked v0.1 |
| 4 | Functional Spec | Pending |
| 5 | ADR Log | Pending |
| 6 | Definition of Done | Pending |

Build begins after Functional Spec lock.

---

## Repository Structure

```
SignalLedger/
├── README.md
├── .gitignore
├── LICENSE
└── docs/
    ├── 01_signal-ledger-charter-v0.1.md
    ├── 02_signal-ledger-use-case-spec-v0.1.md
    ├── 03_signal-ledger-data-dictionary-v0.1.md
    └── amendments/
        └── signal-ledger-pre-functional-spec-amendment-v0.1.md
```

---

## Related Projects

- [AegisRelay](https://github.com/jropenshaw1/AegisRelay) — multi-provider AI ingress service (deferred as Signal Ledger write path; v2 migration candidate)
- [LENS](https://github.com/jropenshaw1/LENS) — governance framework used to structure this project
- [PipelinePilot](https://github.com/jropenshaw1/PipelinePilot) — job search pipeline manager (same builder, same methodology)

---

## License

Apache 2.0
