// near-intents.mjs tests — tokens listing, quote, and swap status.
// Requires internet access; calls 1click.chaindefuser.com (NEAR Intents API).
//
// Tests:
//   1. tokens: lists supported tokens, output contains chain:SYMBOL entries
//   2. tokens --chain near: filters by chain, output contains near: entries
//   3. tokens --chain fake: exits 1 with "No tokens found" error
//   4. quote: gets a committed quote for 1 USDC from ETH, asserts the Send:, Receive:,
//      Send (units):, Deposit to:, Valid until: (with minutes remaining), and
//      (origin-chain variant) Refund to: output lines
//   5. missing --refund: runs the quote command without --refund, asserts exit 1 and usage output
//   6. unknown token: uses a non-existent chain:SYMBOL (fake:FAKE), asserts exit 1
//      and a "Token not found" error message
//   7. missing --usdc: runs the quote command without --usdc, asserts exit 1 and usage output
//   8. missing --from: runs the quote command without --from, asserts exit 1 and usage output
//   9. status: calls the status subcommand with a dummy deposit address,
//      asserts the output contains a "Status:" line
//  10. flag-as-value: --refund immediately followed by another flag (no real value)
//      is treated as missing, exits 1 with usage output
//  11. --refund-type intents without --refund: quote succeeds, refund defaults to --wallet
//      and the output shows a "NEAR Intents balance" Refund to: line
//  12. invalid --refund-type: exits 1 with an error

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, TEST_ADDRESS } from './helpers.mjs';

test('near-intents: tokens lists chain:SYMBOL entries', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', ['tokens']);
  assert.equal(code, 0);
  assert.match(stdout, /\w+:\w+/);
});

test('near-intents: tokens --chain near filters results', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', ['tokens', '--chain', 'near']);
  assert.equal(code, 0);
  assert.match(stdout, /near:/i);
});

test('near-intents: tokens --chain fake exits 1', { timeout: 20_000 }, async () => {
  const { code, stderr } = await run('near-intents.mjs', ['tokens', '--chain', 'fake']);
  assert.equal(code, 1);
  assert.match(stderr, /No tokens found/i);
});

test('near-intents: quote shows Send, Receive, Send (units), Deposit to, Valid until', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH',
    '--wallet', TEST_ADDRESS, '--refund', TEST_ADDRESS,
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Send:/);
  assert.match(stdout, /Receive:/);
  assert.match(stdout, /Send \(units\):/);
  assert.match(stdout, /Deposit to:/);
  // ISO deadline plus a human-readable minutes-remaining hint
  assert.match(stdout, /Valid until: \d{4}-\d{2}-\d{2}T.*\(~\d+ minutes from now\)/);
  assert.match(stdout, /Refund to:.*origin chain/);
});

test('near-intents: errors when no --refund provided', async () => {
  const { code, stderr } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH', '--wallet', TEST_ADDRESS,
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('near-intents: errors on unknown token', { timeout: 20_000 }, async () => {
  const { code, stderr } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'fake:FAKE', '--wallet', TEST_ADDRESS, '--refund', TEST_ADDRESS,
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /Token not found/i);
});

test('near-intents: errors with missing --usdc', async () => {
  const { code, stderr } = await run('near-intents.mjs', ['quote', '--from', 'eth:ETH']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('near-intents: errors with missing --from', async () => {
  const { code, stderr } = await run('near-intents.mjs', ['quote', '--usdc', '1.00']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('near-intents: status returns a status line', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', [
    'status', '0x0000000000000000000000000000000000000001',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Status:/);
});

test('near-intents: errors when --refund value is missing (next token is a flag)', async () => {
  const { code, stderr } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH', '--refund', '--wallet', TEST_ADDRESS,
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('near-intents: --refund-type intents defaults refund to --wallet', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH',
    '--wallet', TEST_ADDRESS, '--refund-type', 'intents',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Deposit to:/);
  // Refund defaults to the --wallet address (lowercased — the intents account id format)
  // and is held as a NEAR Intents balance.
  assert.match(stdout, new RegExp(`Refund to:\\s+${TEST_ADDRESS.toLowerCase()}.*NEAR Intents balance`));
});

test('near-intents: errors on invalid --refund-type', async () => {
  const { code, stderr } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH', '--wallet', TEST_ADDRESS, '--refund-type', 'bogus',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /--refund-type must be/i);
});
