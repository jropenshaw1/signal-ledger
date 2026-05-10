# ADR-014: Paragraph-Boundary Chunking for Oversized Articles

**Status:** Accepted  
**Date:** 2026-05-09  
**Set:** D — Operational-Reality  
**Source:** EC batch backfill operational finding — 26 articles exceeded text-embedding-3-small's 8192-token input limit, causing embedding failures.

## Context

During the EC batch backfill (285 articles ingested), 26 articles exceeded the 8192-token input limit for OpenAI's text-embedding-3-small model. These articles had `embedding_status=failed` after ingestion. The original `sl_embed_article` edge function assumed all article bodies would fit in a single embedding call — a valid assumption for most articles but not for long-form pieces (up to ~20K tokens).

## Decision

Implement paragraph-boundary chunking at approximately 6,000 tokens per chunk for articles exceeding the 8192-token embedding model limit. Each chunk is embedded independently and stored as a separate row in `sl_signpost_embeddings` with a `chunk_index` field.

### Schema changes (Migration 003):

- Added `chunk_index` (integer, default 0), `chunk_text` (text, nullable), and `total_chunks` (integer, default 1) to `sl_signpost_embeddings`
- Dropped unique constraint `uq_sse_article_model` on `(article_id, model_id)`
- Added unique constraint `uq_sse_article_chunk` on `(article_id, chunk_index)`

### Edge function changes:

- `sl_embed_article` v2 uses `text_chunker.ts` shared module
- Chunks at paragraph boundaries (~6K tokens per chunk)
- All-or-nothing rollback per article: if any chunk fails, all chunks for that article are deleted, status stays `failed`
- 12 unit tests for chunker

## Alternatives Considered

**Truncation to 8192 tokens.** Rejected. Loses content, violates P3 immutability principle (the embedding would not represent the full article).

**Larger embedding model (text-embedding-3-large).** Considered but still has token limits, just higher. Chunking is needed regardless for very long articles. Cost increase not justified for corpus size.

**Summarize-then-embed.** Rejected. Introduces lossy transformation that is not reversible and would require re-embedding if summarization quality improves.

## Consequences

- `sl_signpost_embeddings` cardinality changed from 1:1 to 1:many relative to `sl_articles`
- Data Dictionary updated from v0.3 to v0.4 (entity E8 updated, all 8 changeset sections applied)
- Search queries against `sl_signpost_embeddings` now return chunk-level matches; retrieval tools must handle multi-chunk articles
- All 287 articles now at `embedding_status=complete` (329 total embedding rows, 26 multi-chunk, max 5 chunks)

## Backward-Flow Check (per G4)

- **Data Dictionary:** Updated to v0.4. Triggered.
- **Functional Spec:** v1.1 §2 retry caps remain valid; chunking is additive. No revision needed.
- **All other upstream artifacts:** No correction needed.
