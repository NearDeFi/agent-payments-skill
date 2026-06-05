// search-services.mjs tests — verifies keyword search, listing, detail lookup, and source flag.
//
// Tests:
//   1. search (default x402-list): finds results with a price line
//   2. search no results: nonsense keyword returns "No results found."
//   3. search keyword: a topical keyword surfaces the matching example service
//   4. details: x402-list hit — returns Service, URL, Status fields for a known service
//   5. details: unknown URL exits 1 with "not found" error
//   6. search --source bazaar: hits Coinbase bazaar, runs cleanly (described services only)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.mjs';

test('search-services: finds results from x402-list', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-services.mjs', ['search']);
  assert.equal(code, 0);
  assert.match(stdout, /\$\d+\.\d+/, 'expected at least one price line');
});

test('search-services: returns "No results found." for unknown keyword', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-services.mjs', ['search', 'zzznomatchkeyword999']);
  assert.equal(code, 0);
  assert.equal(stdout, 'No results found.');
});

test('search-services: keyword surfaces the matching service', { timeout: 20_000 }, async () => {
  // A topical keyword should narrow to relevant services. Our crypto-news example
  // service (Otto AI, https://x402.ottoai.services) is listed on x402-list with
  // "news" in its description, so searching "news" should surface it.
  //
  // NOTE: this deliberately couples to a specific third-party service being present in
  // the externally-managed x402-list. It needs live network access and will fail if Otto
  // AI is delisted/renamed or its description changes — an accepted trade-off for
  // asserting our example service is discoverable by keyword.
  const { code, stdout } = await run('search-services.mjs', ['search', 'news']);
  assert.equal(code, 0);
  assert.match(stdout, /x402\.ottoai\.services/, 'expected the crypto-news example service for keyword "news"');
});

test('search-services: details returns service metadata from x402-list', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-services.mjs', ['details', 'https://x402.robtex.com']);
  assert.equal(code, 0);
  assert.match(stdout, /Service:/i);
  assert.match(stdout, /URL:/i);
  assert.match(stdout, /Status:/i);
});

test('search-services: details exits 1 for unknown URL', { timeout: 20_000 }, async () => {
  const { code, stderr } = await run('search-services.mjs', ['details', 'https://does-not-exist.example.invalid']);
  assert.equal(code, 1);
  assert.match(stderr, /not found/i);
});

test('search-services: --source bazaar runs cleanly against Coinbase bazaar', { timeout: 30_000 }, async () => {
  const { code, stdout } = await run('search-services.mjs', ['search', '--source', 'bazaar']);
  assert.equal(code, 0);
  // Described-only listing: either priced rows or the explicit empty message — never a crash.
  assert.match(stdout, /\$\d+\.\d+|No results found\./, 'expected price lines or the no-results message');
});
