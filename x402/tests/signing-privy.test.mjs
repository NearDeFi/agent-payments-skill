// Privy server wallet signing test (REST — no SDK needed).
// Requires: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_WALLET_ID
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Runs sign-x402-payment.mjs payload to get an EIP-712 signing payload from the fixture requirements
//   3. Calls Privy's REST API (POST /api/v1/wallets/{id}/rpc) with method eth_signTypedData_v4
//      and the EIP-712 payload fields (note: primary_type in snake_case as required by Privy)
//   4. Asserts the API returns HTTP 200
//   5. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, PAYMENT_REQUIRED_FIXTURE } from './helpers.mjs';

test('Privy: signs EIP-712 payload via eth_signTypedData_v4 REST API', { timeout: 30_000 }, async () => {
  const missing = ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_WALLET_ID'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run Privy tests: ${missing.join(', ')}`);

  const { code, stdout } = await run('sign-x402-payment.mjs', ['payload', '--requirements', PAYMENT_REQUIRED_FIXTURE]);
  assert.equal(code, 0, 'payload command should succeed');

  const payload = JSON.parse(stdout);
  const walletId = process.env.PRIVY_WALLET_ID;
  const appId = process.env.PRIVY_APP_ID;
  const credentials = Buffer.from(`${appId}:${process.env.PRIVY_APP_SECRET}`).toString('base64');

  const res = await fetch(`https://auth.privy.io/api/v1/wallets/${walletId}/rpc`, {
    method: 'POST',
    headers: {
      'privy-app-id': appId,
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: 'eth_signTypedData_v4',
      params: {
        typed_data: {
          domain: payload.domain,
          types: payload.types,
          primary_type: payload.primaryType,
          message: payload.message,
        },
      },
    }),
  });

  assert.equal(res.status, 200, `Privy API returned ${res.status}`);
  const { data } = await res.json();
  assert.match(data.signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
