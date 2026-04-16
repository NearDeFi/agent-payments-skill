// search-bazaar.mjs tests — verifies keyword search, full listing, and service detail lookup
// against the live bazaar API. Requires internet access; fetches from api.cdp.coinbase.com.
//
// Tests:
//   1. search with --all: searches for "api" including services without descriptions,
//      asserts at least one result contains a price line (e.g. "$0.001000")
//   2. search no results: searches for a nonsense keyword that matches nothing,
//      asserts the output is exactly "No results found."
//   3. search --all (no keyword): lists all services in the bazaar without filtering,
//      asserts at least one result is returned with a price
//   4. details: fetches full metadata for the known example service URL,
//      asserts the output contains Resource, Price, and Network fields

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.mjs';

test('search-bazaar: finds results for keyword "api" (including undescribed services)', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-bazaar.mjs', ['search', '--all', 'api']);
  assert.equal(code, 0);
  assert.match(stdout, /\$\d+\.\d+/, 'expected at least one price line');
});

test('search-bazaar: returns "No results found." for unknown keyword', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-bazaar.mjs', ['search', 'zzznomatchkeyword999']);
  assert.equal(code, 0);
  assert.equal(stdout, 'No results found.');
});

test('search-bazaar: --all returns results', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-bazaar.mjs', ['search', '--all']);
  assert.equal(code, 0);
  assert.match(stdout, /\$\d+\.\d+/, 'expected at least one price line with --all');
});

test('search-bazaar: details returns resource metadata for a known service', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-bazaar.mjs', ['details', 'https://xx402.vercel.app/weather']);
  assert.equal(code, 0);
  assert.match(stdout, /Resource:/i);
  assert.match(stdout, /Price:/i);
  assert.match(stdout, /Networks:/i);
});
