# Signal Ledger Dashboard — UI Kit

Operational console for the Signal Ledger system operator (Jonathan Openshaw).
A pixel-close recreation of the 4-zone dashboard layout — dark theme, data-dense, no consumer UX tropes.

## Structure

| File | Description |
|---|---|
| `index.html` | Full operational console — load this to see the dashboard |
| `ProviderBar.jsx` | Top fixed bar: provider identity, tier, article count, gap window, evaluation |
| `IngestionMonitor.jsx` | Left panel: live capture event feed with retry chain visualization |
| `CorpusExplorer.jsx` | Center panel: article inventory with sort, filter, expandable rows |
| `RetrievalLifecycle.jsx` | Right panel: 6-tab retrieval interface (Targeted, Inferential, Framing, Audit, Evaluative, Kit Status) |

## Design Spec

- **Layout:** 4-zone console — ProviderBar (56px top) + 3-column body (300px left, flex center, 360px right)
- **Theme:** Dark (`#0A0C0F` base), operator console aesthetic
- **Type:** Inter (labels, prose) + JetBrains Mono (all data values, IDs, codes)
- **Status colors:** Green=complete/success · Violet=preview-only(source) · Amber=partial/retry(system) · Red=failed/terminal · Blue=processing/active
- **Charter P9:** `preview-only` (violet, source-not-provided) visually distinct from `partial` (amber, system-failed)

## Interactive features

- Click any article row to expand → shows author signposts, cited claims, structured blocks
- Retrieval tabs are clickable — each shows a different query interface
- Audit tab has scope toggles: coverage / completeness / gaps / ingestion-health
- Kit Status tab has lifecycle filter buttons
- Corpus Explorer has content-type and completeness dropdowns

## Notes / caveats

- No authentication UI — system is accessed via MCP tools through agents
- All data is representative sample data, not live
- Retrieval results are static mockups — no real vector search
- `published_date` appears on every artifact display per Charter P3
