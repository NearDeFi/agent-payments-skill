// CDP SDK signing test.
// Requires: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET, CDP_WALLET_ADDRESS
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Runs sign-x402-payment.mjs payload to get an EIP-712 signing payload from the fixture requirements
//   3. Builds the signer object exactly as documented in references/wallet-flows.md
//      (CDP sub-section under "Managed signer wallets: CDP, Privy, Turnkey")
//   4. Calls signer.signTypedData(payload) — this is the path @x402/fetch will exercise
//      via wrapFetchWithPayment at runtime
//   5. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, PAYMENT_REQUIRED_FIXTURE } from './helpers.mjs';

test('CDP: documented signer wrapper produces a valid EIP-712 signature', { timeout: 30_000 }, async () => {
  const missing = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET', 'CDP_WALLET_ADDRESS'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run CDP tests: ${missing.join(', ')}`);

  const { code, stdout } = await run('sign-x402-payment.mjs', ['payload', '--requirements', PAYMENT_REQUIRED_FIXTURE]);
  assert.equal(code, 0, 'payload command should succeed');

  const payload = JSON.parse(stdout);
  assert.ok(payload.domain, 'missing domain');
  assert.ok(payload.types, 'missing types');
  assert.ok(payload.message, 'missing message');

  // Replace the placeholder with the actual CDP wallet address
  payload.message.from = process.env.CDP_WALLET_ADDRESS;

  const { CdpClient } = await import('@coinbase/cdp-sdk');
  const cdp = new CdpClient(); // reads CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET from env

  const signer = {
    address: process.env.CDP_WALLET_ADDRESS,
    signTypedData: async ({ domain, types, primaryType, message }) => {
      const { signature } = await cdp.evm.signTypedData({
        address: signer.address,
        domain, types, primaryType, message,
      });
      return signature;
    },
  };

  const signature = await signer.signTypedData(payload);
  assert.match(signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
