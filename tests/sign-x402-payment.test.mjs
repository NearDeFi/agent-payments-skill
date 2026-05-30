// sign-x402-payment.mjs tests — verifies the payload and sign subcommands.
// No network access or wallet credentials needed; uses the fixture requirements and test key.
//
// Tests:
//   1. payload command: decodes fixture requirements and prints a valid EIP-712 JSON object
//      with domain (chainId=8453, name="USD Coin"), types, and message fields
//   2. sign command: signs the fixture requirements with the test key and prints a base64
//      PAYMENT-SIGNATURE that decodes to a payment object with a valid 65-byte signature
//      and the correct from address matching the test key
//   3. No command: exits 1 and prints usage when called with no arguments
//   4. Invalid base64: exits 1 with "Failed to decode" when requirements are not valid base64
//   5. No key: exits 1 with "No private key" when the sign command is run without a key

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, TEST_KEY, TEST_ADDRESS, PAYMENT_REQUIRED_FIXTURE } from './helpers.mjs';

test('sign: payload command outputs valid EIP-712 JSON', async () => {
  const { code, stdout } = await run('sign-x402-payment.mjs', [
    'payload',
    '--requirements', PAYMENT_REQUIRED_FIXTURE,
  ]);
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.ok(payload.domain, 'missing domain');
  assert.ok(payload.types, 'missing types');
  assert.ok(payload.message, 'missing message');
  assert.equal(payload.domain.chainId, 8453);
  assert.equal(payload.domain.name, 'USD Coin');
});

test('sign: sign command outputs valid base64 PAYMENT-SIGNATURE', { timeout: 10_000 }, async () => {
  const { code, stdout } = await run('sign-x402-payment.mjs', [
    'sign',
    '--requirements', PAYMENT_REQUIRED_FIXTURE,
    '--key', TEST_KEY,
  ]);
  assert.equal(code, 0);
  const decoded = JSON.parse(Buffer.from(stdout, 'base64').toString('utf8'));
  assert.ok(decoded.payload?.signature, 'missing signature');
  assert.match(decoded.payload.signature, /^0x[0-9a-fA-F]{130}$/, 'signature should be 65 bytes (0x + 130 hex chars)');
  assert.equal(decoded.payload.authorization.from.toLowerCase(), TEST_ADDRESS.toLowerCase());
});

test('sign: errors with no command', async () => {
  const { code, stderr } = await run('sign-x402-payment.mjs', []);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('sign: errors on invalid base64', async () => {
  const { code, stderr } = await run('sign-x402-payment.mjs', ['sign', '--requirements', '!!!not-base64!!!']);
  assert.equal(code, 1);
  assert.match(stderr, /Failed to decode/i);
});

test('sign: errors with no key when key required', async () => {
  const { code, stderr } = await run('sign-x402-payment.mjs', [
    'sign', '--requirements', PAYMENT_REQUIRED_FIXTURE,
  ], { X402_PRIVATE_KEY: '', PRIVATE_KEY: '', WALLET_PRIVATE_KEY: '', ETH_PRIVATE_KEY: '' });
  assert.equal(code, 1);
  assert.match(stderr, /No private key/i);
});
