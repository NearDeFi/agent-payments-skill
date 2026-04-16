// intents-quote.mjs tests — verifies dry quotes, error handling, and swap status.
// Requires internet access; calls 1click.chaindefuser.com (NEAR Intents API).
//
// Tests:
//   1. dry quote: gets a preview quote for 1 USDC from ETH with wallet and refund address set,
//      asserts the output contains "Send:" and "Receive:" lines
//   2. no --refund warning: runs a dry quote without --refund, asserts a warning is printed
//      to stderr explaining that failed swap funds won't auto-refund to the origin address
//   3. unknown token: uses a non-existent chain:SYMBOL (fake:FAKE), asserts exit 1
//      and a "Token not found" error message
//   4. missing --usdc: runs the quote command without --usdc, asserts exit 1 and usage output
//   5. missing --from: runs the quote command without --from, asserts exit 1 and usage output
//   6. status: calls the status subcommand with a dummy deposit address,
//      asserts the output contains a "Status:" line (API always returns a status, even for unknown addresses)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, TEST_ADDRESS } from './helpers.mjs';

test('intents-quote: dry quote shows Send and Receive', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('intents-quote.mjs', [
    'quote', '--dry', '--usdc', '1.00', '--from', 'eth:ETH',
    '--wallet', TEST_ADDRESS, '--refund', TEST_ADDRESS,
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Send:/);
  assert.match(stdout, /Receive:/);
});

test('intents-quote: warns when no --refund provided', { timeout: 20_000 }, async () => {
  const { stderr } = await run('intents-quote.mjs', [
    'quote', '--dry', '--usdc', '1.00', '--from', 'eth:ETH', '--wallet', TEST_ADDRESS,
  ]);
  assert.match(stderr, /no --refund/i);
});

test('intents-quote: errors on unknown token', { timeout: 20_000 }, async () => {
  const { code, stderr } = await run('intents-quote.mjs', [
    'quote', '--dry', '--usdc', '1.00', '--from', 'fake:FAKE', '--wallet', TEST_ADDRESS,
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /Token not found/i);
});

test('intents-quote: errors with missing --usdc', async () => {
  const { code, stderr } = await run('intents-quote.mjs', ['quote', '--from', 'eth:ETH']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('intents-quote: errors with missing --from', async () => {
  const { code, stderr } = await run('intents-quote.mjs', ['quote', '--usdc', '1.00']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('intents-quote: --status returns a status line', { timeout: 20_000 }, async () => {
  const { code, stdout } = await run('intents-quote.mjs', [
    'status', '0x0000000000000000000000000000000000000001',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Status:/);
});
