/**
 * text_chunker_test.ts — Tests for the paragraph-boundary text chunker.
 *
 * Run: deno test supabase/functions/_shared/text_chunker_test.ts
 */

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { chunkText, validateChunks, type TextChunk } from "./text_chunker.ts";

// --- Helper: generate text of approximate token count ---
function generateText(targetTokens: number): string {
  // ~4 chars per token, use real-ish words
  const words = "The model is now better at messy multi-part tasks planning tool use ambiguity self-checking and continuing until the work is finished ".split(" ");
  let text = "";
  const targetChars = targetTokens * 4;
  while (text.length < targetChars) {
    text += words[Math.floor(Math.random() * words.length)] + " ";
  }
  return text.trim();
}

function generateParagraphs(count: number, tokensPerPara: number): string {
  return Array.from({ length: count }, () => generateText(tokensPerPara)).join("\n\n");
}

// --- Tests ---

Deno.test("chunkText: empty string returns empty array", () => {
  const result = chunkText("");
  assertEquals(result.length, 0);
});

Deno.test("chunkText: whitespace-only returns empty array", () => {
  const result = chunkText("   \n\n   ");
  assertEquals(result.length, 0);
});

Deno.test("chunkText: short text returns single chunk at index 0", () => {
  const text = "This is a short article about AI agents.";
  const result = chunkText(text);
  assertEquals(result.length, 1);
  assertEquals(result[0].chunk_index, 0);
  assertEquals(result[0].text, text);
  assert(result[0].estimated_tokens < 100);
});

Deno.test("chunkText: text under 6000 tokens stays as one chunk", () => {
  const text = generateText(5000);
  const result = chunkText(text);
  assertEquals(result.length, 1);
  assertEquals(result[0].chunk_index, 0);
});

Deno.test("chunkText: text over 6000 tokens splits into multiple chunks", () => {
  // 10 paragraphs of ~1000 tokens each = ~10000 tokens total
  const text = generateParagraphs(10, 1000);
  const result = chunkText(text);
  assert(result.length >= 2, `Expected >= 2 chunks, got ${result.length}`);

  // All chunks should be within limits
  const { valid } = validateChunks(result);
  assert(valid, "All chunks should be within token limits");
});

Deno.test("chunkText: chunk indices are sequential starting at 0", () => {
  const text = generateParagraphs(15, 800);
  const result = chunkText(text);
  for (let i = 0; i < result.length; i++) {
    assertEquals(result[i].chunk_index, i, `Chunk ${i} has wrong index`);
  }
});

Deno.test("chunkText: very long article (~20K tokens) chunks correctly", () => {
  // Simulates a Nate-length article (~20K tokens, ~80K chars)
  const text = generateParagraphs(40, 500);
  const result = chunkText(text);
  assert(result.length >= 3, `Expected >= 3 chunks, got ${result.length}`);

  const { valid, violations } = validateChunks(result);
  assert(valid, `Chunks exceeded limits at indices: ${violations}`);

  // Total text coverage: all original content should be represented
  // (with possible overlap, so concatenated length >= original)
  const totalChunkChars = result.reduce((sum, c) => sum + c.text.length, 0);
  assert(
    totalChunkChars >= text.trim().length * 0.9,
    "Chunks should cover at least 90% of original text"
  );
});

Deno.test("chunkText: single giant paragraph gets split", () => {
  // One paragraph with no newlines, ~10000 tokens
  const text = generateText(10000);
  const result = chunkText(text);
  assert(result.length >= 2, `Expected >= 2 chunks for oversized paragraph, got ${result.length}`);

  const { valid } = validateChunks(result);
  assert(valid, "All chunks from oversized paragraph should be within limits");
});

Deno.test("chunkText: preserves paragraph structure in chunks", () => {
  const paragraphs = [
    "First paragraph about agents.",
    "Second paragraph about skills.",
    "Third paragraph about plugins.",
  ];
  const text = paragraphs.join("\n\n");
  const result = chunkText(text);

  // Short enough for one chunk
  assertEquals(result.length, 1);
  assert(result[0].text.includes("First paragraph"));
  assert(result[0].text.includes("Third paragraph"));
});

Deno.test("chunkText: estimated_tokens is roughly correct", () => {
  const text = "word ".repeat(1000); // ~1000 tokens
  const result = chunkText(text);
  assertEquals(result.length, 1);
  // 5000 chars / 4 = 1250 estimated tokens (conservative)
  assert(
    result[0].estimated_tokens >= 800 && result[0].estimated_tokens <= 1500,
    `Expected ~1000-1250 estimated tokens, got ${result[0].estimated_tokens}`
  );
});

Deno.test("validateChunks: all valid returns valid=true", () => {
  const chunks: TextChunk[] = [
    { chunk_index: 0, text: "short", estimated_tokens: 100 },
    { chunk_index: 1, text: "also short", estimated_tokens: 200 },
  ];
  const { valid, violations } = validateChunks(chunks);
  assert(valid);
  assertEquals(violations.length, 0);
});

Deno.test("validateChunks: oversized chunk returns violations", () => {
  const chunks: TextChunk[] = [
    { chunk_index: 0, text: "fine", estimated_tokens: 100 },
    { chunk_index: 1, text: "way too big", estimated_tokens: 9000 },
  ];
  const { valid, violations } = validateChunks(chunks);
  assert(!valid);
  assertEquals(violations, [1]);
});

Deno.test("chunkText: realistic Nate article length (~15K tokens)", () => {
  // Nate's articles typically run 8K-15K tokens
  // Build a realistic structure: title + intro + 8 sections with 3-4 paragraphs each
  const sections = [];
  sections.push("# Article Title\n\nIntro paragraph " + generateText(200));
  for (let i = 0; i < 8; i++) {
    const section = `## Section ${i + 1}\n\n` + generateParagraphs(3, 500);
    sections.push(section);
  }
  const text = sections.join("\n\n");
  const result = chunkText(text);

  assert(result.length >= 2, `Expected >= 2 chunks, got ${result.length}`);
  assert(result.length <= 6, `Expected <= 6 chunks, got ${result.length} (too many splits)`);

  const { valid } = validateChunks(result);
  assert(valid, "All chunks should be within limits");

  // First chunk should start with the title
  assert(result[0].text.startsWith("# Article Title"), "First chunk should start with title");
});
