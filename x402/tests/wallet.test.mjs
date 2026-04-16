// wallet.mjs tests — verifies address derivation, balance checking, and key generation.
//
// Tests:
//   1. address: derives the correct EVM address from the well-known test private key
//      (deterministic — asserts the exact expected address)
//   2. address (no key): exits 1 with an error when no private key is in env or args
//   3. balance: calls Base mainnet RPC to fetch the USDC balance of the test address
//      (live network call — asserts the output is a numeric USDC value)
//   4. balance (no address): exits 1 and prints usage when called without an address argument
//   5. new: generates a fresh random private key, prints "Private key:" and "Address:",
//      and the address matches the standard 0x + 40 hex char EVM format

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, TEST_KEY, TEST_ADDRESS } from './helpers.mjs';

test('wallet address: derives correct address from known key', async () => {
  const { code, stdout } = await run('wallet.mjs', ['address'], { PRIVATE_KEY: TEST_KEY });
  assert.equal(code, 0);
  assert.equal(stdout, TEST_ADDRESS);
});

test('wallet address: errors with no key', async () => {
  const { code, stderr } = await run('wallet.mjs', ['address'], {
    PRIVATE_KEY: '', WALLET_PRIVATE_KEY: '', ETH_PRIVATE_KEY: '',
  });
  assert.equal(code, 1);
  assert.match(stderr, /No private key/i);
});

test('wallet balance: returns USDC balance for a valid address', { timeout: 10_000 }, async () => {
  const { code, stdout } = await run('wallet.mjs', ['balance', TEST_ADDRESS]);
  assert.equal(code, 0);
  assert.match(stdout, /\d+\.\d+ USDC/);
});

test('wallet balance: errors with no address', async () => {
  const { code, stderr } = await run('wallet.mjs', ['balance']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('wallet new: generates a key and address', async () => {
  const { code, stdout } = await run('wallet.mjs', ['new']);
  assert.equal(code, 0);
  assert.match(stdout, /Private key:/);
  assert.match(stdout, /Address:/);
  assert.match(stdout, /0x[0-9a-fA-F]{40}/);
});
