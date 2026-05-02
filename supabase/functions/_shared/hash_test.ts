// =============================================================================
// Signal Ledger — hash utility tests
// Run: deno test supabase/functions/_shared/hash_test.ts
// =============================================================================

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeText, sha256Hex } from './hash.ts';

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

Deno.test('[normalizeText] trims whitespace', () => {
  assertEquals(normalizeText('  hello  '), 'hello');
});

Deno.test('[normalizeText] lowercases', () => {
  assertEquals(normalizeText('Hello World'), 'hello world');
});

Deno.test('[normalizeText] collapses internal whitespace', () => {
  assertEquals(normalizeText('hello   world\t\nfoo'), 'hello world foo');
});

Deno.test('[normalizeText] combined: trim + lowercase + collapse', () => {
  assertEquals(normalizeText('  Hello   World  '), 'hello world');
});

Deno.test('[normalizeText] empty string → empty string', () => {
  assertEquals(normalizeText(''), '');
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

Deno.test('[sha256Hex] known SHA-256 digest', async () => {
  // SHA-256 of empty string = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const hash = await sha256Hex('');
  assertEquals(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

Deno.test('[sha256Hex] known digest for "hello"', async () => {
  // SHA-256 of "hello" = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  const hash = await sha256Hex('hello');
  assertEquals(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

Deno.test('[sha256Hex] returns 64 lowercase hex characters', async () => {
  const hash = await sha256Hex('test input');
  assertEquals(hash.length, 64);
  assertEquals(hash, hash.toLowerCase());
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
});

Deno.test('[sha256Hex] deterministic — same input → same output', async () => {
  const a = await sha256Hex('Signal Ledger');
  const b = await sha256Hex('Signal Ledger');
  assertEquals(a, b);
});

Deno.test('[sha256Hex] different input → different output', async () => {
  const a = await sha256Hex('input A');
  const b = await sha256Hex('input B');
  assertEquals(a === b, false);
});
