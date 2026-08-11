// near-intents.mjs tests — tokens listing, quote, and swap status.
// Requires internet access; calls 1click.chaindefuser.com (NEAR Intents API).
//
// Tests:
//   1. tokens: lists supported tokens, output contains chain:SYMBOL entries
//   2. tokens --chain near: filters by chain, output contains near: entries
//   3. tokens --chain fake: exits 1 with "No tokens found" error
//   4. quote: gets a committed quote for 1 USDC from ETH, asserts the Send:, Receive:,
//      Send (units):, Deposit to:, Deposit by: (a ~2h window, with minutes remaining),
//      and the origin-chain Refund to: output lines
//   5. missing --refund: runs the quote command without --refund, asserts exit 1 and usage output
//   6. unknown token: uses a non-existent chain:SYMBOL (fake:FAKE), asserts exit 1
//      and a "Token not found" error message
//   7. missing --usdc: runs the quote command without --usdc, asserts exit 1 and usage output
//   8. missing --from: runs the quote command without --from, asserts exit 1 and usage output
//   9. status: an unknown deposit address is a permanent (4xx) failure — asserts the
//      output is a FATAL line carrying the API's message and the exit code is 1, so the
//      documented monitor loop breaks instead of polling "Status: undefined" forever
//  10. flag-as-value: --refund immediately followed by another flag (no real value)
//      is treated as missing, exits 1 with usage output
//  11. --refund-type is no longer supported: passing it exits 1 with an explanatory error
//      instead of silently falling back to an origin-chain refund
//  12. same for the inline --refund-type=intents form, which an unmatched flag check
//      would otherwise ignore

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

test('near-intents: quote shows Send, Receive, Send (units), Deposit to, Deposit by', { timeout: 20_000 }, async () => {
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
  const deadlineLine = stdout.match(/Deposit by: \d{4}-\d{2}-\d{2}T\S+ \(~(\d+) minutes from now\)/);
  assert.ok(deadlineLine, `expected a "Deposit by:" line, got:\n${stdout}`);
  // The requested window is 2h; allow slack for the round trip.
  const minutesLeft = Number(deadlineLine[1]);
  assert.ok(minutesLeft > 110 && minutesLeft <= 120, `expected a ~120 minute window, got ${minutesLeft}`);
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

test('near-intents: status fails fatally on an unknown deposit address', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('near-intents.mjs', [
    'status', '0x0000000000000000000000000000000000000001',
  ]);
  // A 4xx is permanent: print FATAL (which the documented monitor loop breaks on) and exit
  // non-zero, rather than printing `Status: undefined` and letting the loop poll forever.
  assert.equal(code, 1);
  assert.match(stdout, /^FATAL: .*not found/im);
  assert.doesNotMatch(stdout, /Status: undefined/);
});

test('near-intents: errors when --refund value is missing (next token is a flag)', async () => {
  const { code, stderr } = await run('near-intents.mjs', [
    'quote', '--usdc', '1.00', '--from', 'eth:ETH', '--refund', '--wallet', TEST_ADDRESS,
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

// Both spellings must be rejected: unknown args are otherwise ignored, so an unmatched
// `--refund-type=intents` would silently fall back to an origin-chain refund.
for (const form of [['--refund-type', 'intents'], ['--refund-type=intents']]) {
  test(`near-intents: rejects ${form[0]} instead of silently ignoring it`, async () => {
    const { code, stderr } = await run('near-intents.mjs', [
      'quote', '--usdc', '1.00', '--from', 'eth:ETH',
      '--wallet', TEST_ADDRESS, '--refund', TEST_ADDRESS, ...form,
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /--refund-type is no longer supported/i);
  });
}
