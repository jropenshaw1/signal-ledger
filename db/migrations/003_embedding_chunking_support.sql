-- Migration 003: Embedding chunking support
-- Adds chunk_index and chunk_text to sl_signpost_embeddings
-- to support articles that exceed the 8192-token embedding model limit.
--
-- Existing embeddings (single-chunk) get chunk_index=0 via DEFAULT.
-- Multi-chunk articles get chunk_index=0,1,2,...
-- chunk_text stores the actual text that was embedded for that chunk,
-- enabling re-embedding without re-chunking and provenance inspection.

-- Drop the v0.3 unique constraint on (article_id, model_id) that blocks multi-chunk inserts
-- (Per ADR-014: cardinality changes from 1:1 to 1:many per article)
ALTER TABLE sl_signpost_embeddings
  DROP CONSTRAINT IF EXISTS uq_sse_article_model;

-- Add chunk_index: which chunk of the article this embedding represents
ALTER TABLE sl_signpost_embeddings
  ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;

-- Add chunk_text: the actual text input sent to the embedding model
ALTER TABLE sl_signpost_embeddings
  ADD COLUMN IF NOT EXISTS chunk_text TEXT;

-- Add total_chunks: how many chunks the article was split into
-- (denormalized for query convenience — avoids COUNT(*) on every read)
ALTER TABLE sl_signpost_embeddings
  ADD COLUMN IF NOT EXISTS total_chunks INTEGER NOT NULL DEFAULT 1;

-- Unique constraint: one embedding per (article, chunk_index) pair
-- This replaces any implicit assumption of 1:1 article:embedding
ALTER TABLE sl_signpost_embeddings
  ADD CONSTRAINT uq_sse_article_chunk
  UNIQUE (article_id, chunk_index);

-- Index for chunk-aware similarity search:
-- queries will filter by article_id or scan all chunks
CREATE INDEX IF NOT EXISTS idx_sse_article_chunk
  ON sl_signpost_embeddings (article_id, chunk_index);

COMMENT ON COLUMN sl_signpost_embeddings.chunk_index IS
  'Zero-based index of this chunk within the article. 0 for single-chunk articles.';
COMMENT ON COLUMN sl_signpost_embeddings.chunk_text IS
  'The actual text sent to the embedding model for this chunk. Enables re-embedding and provenance.';
COMMENT ON COLUMN sl_signpost_embeddings.total_chunks IS
  'Total number of chunks for this article. Denormalized for query convenience.';
