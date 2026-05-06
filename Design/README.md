# Signal Ledger — Design

**Product:** Signal Ledger — a personal content intelligence system built agent-first by Jonathan Openshaw.
**Brand palette:** Openshaw theme (light, high-contrast, amber/burnt sienna). Established 2026-05-03.

---

## Active Design Foundation

The active design token file is `brand_tokens.css` in this directory. All future design work — component generation, Claude Design sessions, prototype builds — starts from these tokens.

### Brand palette summary

| Role | Value | Notes |
|---|---|---|
| Accent | `#c2410c` | Burnt sienna — buttons, active tabs, links, scores |
| Background base | `#f3ebe2` | Page/viewport — warm parchment |
| Background surface | `#f8f2eb` | Panel backgrounds |
| Background header | `#e4d5c4` | Top bars, provider bars, nav |
| Background elevated | `#fff` | Cards, modals, active elements |
| Border default | `#c4a882` | Panel/card borders |
| Border subtle | `#e4d9cc` | Row dividers |
| Border elevated | `#b8956e` | Signpost accents |
| Text primary | `#1c1008` | Near-black warm — headings, body |
| Text secondary | `#4a3520` | Secondary labels |
| Text muted | `#8b7260` | Timestamps, IDs, meta |
| Font sans | Inter | UI text, labels, headers |
| Font mono | JetBrains Mono | Data values, IDs, timestamps, scores |

### Design decisions

- **Light mode only.** Deliberate rejection of dark-mode defaults. The operator console aesthetic is achieved through data density and typographic hierarchy, not background color.
- **High contrast.** Text primary is near-black (`#1c1008`), not medium gray. Font weights lean bold (700) on headings and badges. Borders are visible, not ghosted.
- **Warm neutral ramp.** Backgrounds, borders, and muted text all share the same amber undertone. No cool grays mixed in.
- **Semantic status colors are universal.** Green (success), red (danger), amber (warning), violet (preview-only) use standard values across all projects — they carry meaning, not brand. The brand lives in the neutrals and the accent.
- **Typography pairing is fixed.** Inter for UI, JetBrains Mono for data. No substitutions.

---

## Content fundamentals

Signal Ledger's written language is terse, precise, and system-native.

### Voice and tone
- First person possessive, no second person: "Jonathan's subscription," "the corpus," never "your articles"
- Declarative over imperative: state what is true, not what to do
- No softening language when the data is exact
- Precise enumeration: always use canonical field values from the data dictionary
- Dates in `YYYY-MM-DD` format, always with source/artifact reference

### The distinction that must never be blurred (Charter P9)
- `preview-only` = source did not provide (paywall, tier gating) — not a system failure
- `partial` = system failed to capture — retry warranted
- These must be visually distinct in every artifact display

### Status badge system

| Status | Color | Symbol |
|---|---|---|
| `complete` | green | `●` filled dot |
| `preview-only` | violet | `◐` half-filled (source-gated) |
| `partial` | amber | `◑` half-filled (system-failed) |
| `pending` | muted | `○` empty dot |
| `processing` | accent | `◌` animated dot |
| `failed` | red | `✕` cross |

### Casing rules
- Entity names: lowercase with underscores (`capture_completeness`, `embedding_status`)
- Event types: lowercase snake_case (`ingestion_started`, `embedding_failed`)
- Status labels: lowercase (`complete`, `preview-only`, `partial`)
- UI section labels: Title Case for panel headers ("Ingestion Monitor", "Corpus Explorer")
- No emoji anywhere

---

## Architecture context

| Layer | Technology |
|---|---|
| Storage | pgvector on Supabase |
| Write path | Signal Ledger MCP (Supabase Edge Functions, `sl_*` namespace) |
| Retrieval | 6 MCP tools: Targeted, Inferential, Framing, Audit, Evaluative, Kit Status |
| Ingestion | 2 MCP tools: `sl_ingest_article`, `sl_resolve_gap_window` |
| Lifecycle | 3 MCP tools: `sl_record_kit_evaluation_stamp`, `sl_record_evaluative_session`, `sl_get_provider_record` |
| Agent | Claude (sole orchestrator v1) |

11 MCP tools total. No human browsing UI — all access via MCP tools through AI agents.

### Dashboard layout (4-zone console)
- Provider bar (top, fixed ~56px)
- Ingestion Monitor (left, ~240px fixed)
- Corpus Explorer (center, fluid)
- Retrieval & Lifecycle (right, ~320px fixed, 6 tabs in 3×2 grid)

---

## LENS governance chain

| Layer | Document | Status |
|---|---|---|
| 1 | Charter v0.1 | Locked |
| 2 | Use Case Spec v0.1 | Locked |
| 3 | Data Dictionary v0.1 | Locked |
| 4 | Functional Spec v1.0 | Implementation-binding |
| 5 | ADR Log | Pending |
| 6 | Definition of Done | Pending |

LENS is a separate project and repo (`jropenshaw1/LENS`). Signal Ledger is an application governed by the LENS methodology.

---

## Files

```
Design/
├── brand_tokens.css              ← Active design foundation (Openshaw palette)
├── README.md                     ← This file
└── archive/
    └── v1-dark-theme/            ← Original Claude Design session output (2026-05-03)
        ├── colors_and_type.css   ← Dark-theme token file (superseded)
        ├── preview/              ← 11 HTML component previews
        ├── screenshots/          ← 6 iteration screenshots
        └── ui_kits/
            └── dashboard/        ← Full 4-zone console (index.html + 4 JSX components)
```

### Archive notes
The `v1-dark-theme` directory preserves the complete output from the inaugural Claude Design session. It validated that the LENS documentation chain (Charter → Use Case Spec → Data Dictionary → Functional Spec → MCP Tool Signatures) produces spec-dense enough documentation to generate a working UI mockup in one pass. The dark palette was superseded by the Openshaw brand palette during the same session.

---

## Iteration history

| Date | Action |
|---|---|
| 2026-05-03 | Claude Design session: generated full 4-zone dashboard from LENS spec chain (dark theme) |
| 2026-05-03 | Iterated all 6 retrieval tabs into 3×2 grid layout |
| 2026-05-03 | Established Openshaw brand palette (light, amber/burnt sienna) through palette exploration |
| 2026-05-03 | Archived dark-theme assets, set `brand_tokens.css` as active foundation |

---

*Signal Ledger Design — maintained by Jonathan Openshaw*
