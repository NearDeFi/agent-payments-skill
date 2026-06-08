// near-intents.mjs tests — tokens listing, quote, and swap status.
// Requires internet access; calls 1click.chaindefuser.com (NEAR Intents API).
//
// Tests:
//   1. tokens: lists supported tokens, output contains chain:SYMBOL entries
//   2. tokens --chain near: filters by chain, output contains near: entries
//   3. tokens --chain fake: exits 1 with "No tokens found" error
//   4. quote: gets a committed quote for 1 USDC from ETH,
//      asserts Send:, Receive:, Send (units):, and Deposit to: lines
//   5. missing --refund: runs the quote command without --refund, asserts exit 1 and usage output
//   6. unknown token: uses a non-existent chain:SYMBOL (fake:FAKE), asserts exit 1
//      and a "Token not found" error message
//   7. missing --usdc: runs the quote command without --usdc, asserts exit 1 and usage output
//   8. missing --from: runs the quote command without --from, asserts exit 1 and usage output
//   9. status: calls the status subcommand with a dummy deposit address,
//      asserts the output contains a "Status:" line

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

test('near-intents: quote shows Send, Receive, Send (units), Deposit to', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH',
    '--wallet', TEST_ADDRESS, '--refund', TEST_ADDRESS,
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Send:/);
  assert.match(stdout, /Receive:/);
  assert.match(stdout, /Send \(units\):/);
  assert.match(stdout, /Deposit to:/);
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
