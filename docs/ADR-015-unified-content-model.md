# ADR-015: Unified Content Model for Prompt Kits

**Status:** Accepted  
**Date:** 2026-05-09  
**Set:** D — Operational-Reality  
**Source:** v1 Completion Plan team review (Gee, Copi, Mini, Grok — unanimous agreement). OB entry 12eaaf92.

## Context

Signal Ledger's Data Dictionary v0.4 defines a standalone `sl_prompt_kits` table (entity E4) for prompt kit storage. The v1 Completion Plan requires ingesting 45 prompt kit sources (43 on promptkit.natebjones.com, 2 on Notion). A decision is needed on whether prompt kits should be stored in the existing `sl_prompt_kits` table or unified into `sl_articles` with a `content_type` discriminator.

## Decision

Ingest prompt kits as rows in `sl_articles` with `content_type = 'prompt_kit'`, not as rows in the standalone `sl_prompt_kits` table.

### Rationale (team consensus):

1. **Single search surface.** `sl_search` queries one table and one embedding pipeline. No forked retrieval logic, no complex joins across content types.
2. **Single embedding pipeline.** Prompt kits use the same `sl_signpost_embeddings` table and `sl_embed_article` edge function. No parallel embedding infrastructure.
3. **Single ingestion path.** `sl_ingest_article` handles both content types with the `content_type` field as the discriminator. No parallel ingestion code.
4. **Governance simplicity.** One set of capture events, one audit trail, one provider relationship. No duplicate governance surfaces.

### Schema implications:

- Add `content_type` column to `sl_articles` (text, NOT NULL, default `'article'`, CHECK IN (`'article'`, `'prompt_kit'`))
- `sl_prompt_kits` table (DD v0.4 entity E4) is **not deployed** for v1. It remains in the Data Dictionary as a reserved entity for future use if prompt kits develop lifecycle fields that do not generalize to articles.
- Prompt-kit-specific metadata (source URL, scrape timestamp, content hash) stored in existing `metadata` JSONB column on `sl_articles`

### Fork conditions (when to revisit):

Only fork prompt kits into a separate table if they require:
- Materially different lifecycle fields (versioning, execution metadata, trigger conditions) that would bloat `sl_articles` with nullable columns
- Query performance degradation from mixed content types at scale
- Governance requirements that conflict with article governance

Even then, prefer JSONB extensions or a 1:1 companion table before full separation.

## Alternatives Considered

**Deploy `sl_prompt_kits` as designed in DD v0.4.** Rejected. Creates parallel pipelines for ingestion, embedding, retrieval, and governance. All cost, no benefit at current scale and requirements.

**Separate table with shared embedding.** Considered. Would share `sl_signpost_embeddings` but fork ingestion and retrieval queries. Partial benefit, still creates dual governance surface. Rejected.

## Consequences

- Data Dictionary requires update: `content_type` column added to `sl_articles` (entity E1). `sl_prompt_kits` (E4) marked as reserved/undeployed.
- `sl_ingest_article` edge function needs `content_type` parameter support
- `sl_search` returns both articles and prompt kits; callers can filter by `content_type` if needed
- `sl_get_article` works for both content types without modification

## Backward-Flow Check (per G4)

- **Data Dictionary:** Update required (v0.5). `content_type` column on E1, E4 status change. Triggered.
- **Functional Spec:** Minor update — ingestion transaction boundary unchanged, but `content_type` validation added to MCP boundary. Triggered.
- **All other upstream artifacts:** No correction needed.
