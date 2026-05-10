/**
 * text_chunker.ts — Split text into chunks safe for embedding models.
 *
 * Strategy: paragraph-boundary chunking with a target of ~6000 tokens
 * (well under the 8192 limit for text-embedding-3-small).
 *
 * Token estimation: ~4 chars per token for English text (conservative).
 * We use 24000 chars as the target chunk size (~6000 tokens).
 */

/** A single chunk with its index and text content. */
export interface TextChunk {
  chunk_index: number;
  text: string;
  estimated_tokens: number;
}

/**
 * Rough token estimate: ~4 characters per token for English.
 * This is conservative — OpenAI's actual tokenizer averages ~3.5-4.
 * Using 4 gives us headroom.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Maximum tokens per chunk. We target 6000 to leave headroom
 * below the 8192 model limit.
 */
const MAX_TOKENS_PER_CHUNK = 6000;
const MAX_CHARS_PER_CHUNK = MAX_TOKENS_PER_CHUNK * 4; // 24000 chars

/**
 * Split text into chunks at paragraph boundaries.
 *
 * Rules:
 * 1. If text fits in one chunk, return it as a single chunk.
 * 2. Split on double-newline (paragraph boundary) first.
 * 3. If a single paragraph exceeds the limit, split on single newline.
 * 4. If a single line exceeds the limit, split on sentence boundary.
 * 5. As a last resort, split mid-sentence at the char limit.
 *
 * Each chunk gets 50-token overlap with the previous chunk for
 * context continuity in semantic search.
 */
export function chunkText(text: string): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  // If it fits in one chunk, don't split
  if (estimateTokens(trimmed) <= MAX_TOKENS_PER_CHUNK) {
    return [{
      chunk_index: 0,
      text: trimmed,
      estimated_tokens: estimateTokens(trimmed),
    }];
  }

  // Split into paragraphs (double newline)
  const paragraphs = trimmed.split(/\n\s*\n/);
  const chunks: TextChunk[] = [];
  let currentChunk = "";
  const OVERLAP_CHARS = 200; // ~50 tokens of overlap

  for (const para of paragraphs) {
    const paraText = para.trim();
    if (!paraText) continue;

    const candidateLength = currentChunk
      ? currentChunk.length + 2 + paraText.length // +2 for \n\n join
      : paraText.length;

    if (candidateLength <= MAX_CHARS_PER_CHUNK) {
      // Fits — accumulate
      currentChunk = currentChunk
        ? currentChunk + "\n\n" + paraText
        : paraText;
    } else {
      // Doesn't fit — flush current chunk if non-empty
      if (currentChunk) {
        chunks.push({
          chunk_index: chunks.length,
          text: currentChunk,
          estimated_tokens: estimateTokens(currentChunk),
        });
      }

      // Check if the paragraph itself exceeds the limit
      if (paraText.length > MAX_CHARS_PER_CHUNK) {
        // Split the oversized paragraph into sub-chunks
        const subChunks = splitLargeParagraph(paraText);
        for (const sub of subChunks) {
          chunks.push({
            chunk_index: chunks.length,
            text: sub,
            estimated_tokens: estimateTokens(sub),
          });
        }
        currentChunk = "";
      } else {
        // Start new chunk with overlap from previous
        const overlap = getOverlapSuffix(currentChunk, OVERLAP_CHARS);
        currentChunk = overlap ? overlap + "\n\n" + paraText : paraText;
      }
    }
  }

  // Flush remaining
  if (currentChunk.trim()) {
    chunks.push({
      chunk_index: chunks.length,
      text: currentChunk,
      estimated_tokens: estimateTokens(currentChunk),
    });
  }

  // Re-index to ensure sequential
  return chunks.map((c, i) => ({ ...c, chunk_index: i }));
}

/**
 * Split an oversized paragraph by sentence boundaries,
 * falling back to hard char splits.
 */
function splitLargeParagraph(text: string): string[] {
  // Try splitting by sentences (period + space, or newline)
  const sentences = text.split(/(?<=[.!?])\s+/);
  const results: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current
      ? current + " " + sentence
      : sentence;

    if (candidate.length <= MAX_CHARS_PER_CHUNK) {
      current = candidate;
    } else {
      if (current) results.push(current);

      if (sentence.length > MAX_CHARS_PER_CHUNK) {
        // Hard split as last resort
        for (let i = 0; i < sentence.length; i += MAX_CHARS_PER_CHUNK) {
          results.push(sentence.slice(i, i + MAX_CHARS_PER_CHUNK));
        }
        current = "";
      } else {
        current = sentence;
      }
    }
  }

  if (current) results.push(current);
  return results;
}

/**
 * Get the last N characters of text for overlap context.
 * Tries to break at a sentence or paragraph boundary.
 */
function getOverlapSuffix(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return "";

  const tail = text.slice(-maxChars);
  // Try to start at a sentence boundary
  const sentenceStart = tail.search(/(?<=[.!?])\s+/);
  if (sentenceStart > 0 && sentenceStart < maxChars * 0.5) {
    return tail.slice(sentenceStart).trim();
  }
  return tail.trim();
}

/** Test helper: verify all chunks are within token limits. */
export function validateChunks(chunks: TextChunk[]): {
  valid: boolean;
  violations: number[];
} {
  const violations = chunks
    .filter(c => c.estimated_tokens > MAX_TOKENS_PER_CHUNK * 1.1) // 10% tolerance
    .map(c => c.chunk_index);
  return { valid: violations.length === 0, violations };
}
