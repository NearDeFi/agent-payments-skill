// Privy server wallet signing test (REST — no SDK needed).
// Requires: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_WALLET_ID, PRIVY_WALLET_ADDRESS
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Takes the static EIP-712 payload fixture (the shape @x402/fetch hands the signer)
//   3. Builds the signer object exactly as documented in references/wallet-flows.md
//      (Privy sub-section under "Managed signer wallets: CDP, Privy, Turnkey")
//   4. Calls signer.signTypedData(payload) — the body POSTs to Privy's REST API
//      (POST /api/v1/wallets/{id}/rpc) with method eth_signTypedData_v4 and snake_case primary_type
//   5. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_PAYLOAD_FIXTURE } from './helpers.mjs';

test('Privy: documented signer wrapper produces a valid EIP-712 signature', { timeout: 30_000 }, async () => {
  const missing = ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_WALLET_ID', 'PRIVY_WALLET_ADDRESS'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run Privy tests: ${missing.join(', ')}`);

  const payload = structuredClone(PAYMENT_PAYLOAD_FIXTURE);
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
        // @x402/fetch passes uint256 fields (value, validAfter, validBefore) as BigInt;
        // JSON.stringify throws on BigInt, so stringify them via a replacer.
        body: JSON.stringify(
          {
            method: 'eth_signTypedData_v4',
            params: { typed_data: { domain, types, primary_type: primaryType, message } },
          },
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
        ),
      });
      assert.equal(res.status, 200, `Privy API returned ${res.status}`);
      const { data: { signature } } = await res.json();
      return signature;
    },
  };

  const signature = await signer.signTypedData(payload);
  assert.match(signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
