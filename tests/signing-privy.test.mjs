// Privy server wallet signing test (REST — no SDK needed).
// Requires: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_WALLET_ID, PRIVY_WALLET_ADDRESS
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Runs sign-x402-payment.mjs payload to get an EIP-712 signing payload from the fixture requirements
//   3. Builds the signer object exactly as documented in references/wallet-flows.md
//      (Privy sub-section under "If you are using CDP / Privy / Turnkey / OWS")
//   4. Calls signer.signTypedData(payload) — the body POSTs to Privy's REST API
//      (POST /api/v1/wallets/{id}/rpc) with method eth_signTypedData_v4 and snake_case primary_type
//   5. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, PAYMENT_REQUIRED_FIXTURE } from './helpers.mjs';

test('Privy: documented signer wrapper produces a valid EIP-712 signature', { timeout: 30_000 }, async () => {
  const missing = ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_WALLET_ID', 'PRIVY_WALLET_ADDRESS'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run Privy tests: ${missing.join(', ')}`);

  const { code, stdout } = await run('sign-x402-payment.mjs', ['payload', '--requirements', PAYMENT_REQUIRED_FIXTURE]);
  assert.equal(code, 0, 'payload command should succeed');

  const payload = JSON.parse(stdout);
  payload.message.from = process.env.PRIVY_WALLET_ADDRESS;

  const signer = {
    address: process.env.PRIVY_WALLET_ADDRESS,
    signTypedData: async ({ domain, types, primaryType, message }) => {
      const res = await fetch(`https://auth.privy.io/api/v1/wallets/${process.env.PRIVY_WALLET_ID}/rpc`, {
        method: 'POST',
        headers: {
          'privy-app-id': process.env.PRIVY_APP_ID,
          Authorization: `Basic ${Buffer.from(`${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'eth_signTypedData_v4',
          params: { typed_data: { domain, types, primary_type: primaryType, message } },
        }),
      });
      assert.equal(res.status, 200, `Privy API returned ${res.status}`);
      const { data: { signature } } = await res.json();
      return signature;
    },
  };

  const signature = await signer.signTypedData(payload);
  assert.match(signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
