// search-services.mjs tests — verifies keyword search, listing, detail lookup, and source flag.
//
// Tests:
//   1. search (default x402-list): finds results with a price line
//   2. search no results: nonsense keyword returns "No results found."
//   3. search --all: includes offline services, still returns price lines
//   4. details: x402-list hit — returns Service, URL, Status fields for a known service
//   5. details: unknown URL exits 1 with "not found" error
//   6. search --source bazaar: hits Coinbase bazaar, returns at least one price line

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

test('search-services: --all includes offline services', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('search-services.mjs', ['search', '--all']);
  assert.equal(code, 0);
  assert.match(stdout, /\$\d+\.\d+/, 'expected at least one price line with --all');
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

test('search-services: --source bazaar returns results from Coinbase bazaar', { timeout: 30_000 }, async () => {
  const { code, stdout } = await run('search-services.mjs', ['search', '--all', '--source', 'bazaar']);
  assert.equal(code, 0);
  assert.match(stdout, /\$\d+\.\d+/, 'expected at least one price line from bazaar');
});
