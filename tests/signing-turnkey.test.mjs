// Turnkey signing test using @turnkey/viem.
// Requires: TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID, TURNKEY_SIGN_WITH
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Runs sign-x402-payment.mjs payload to get an EIP-712 signing payload from the fixture requirements
//   3. Converts BigInt fields (validAfter, validBefore, value) from JSON strings back to BigInt
//      (required because JSON.parse cannot represent BigInt natively)
//   4. Builds the signer object exactly as documented in references/wallet-flows.md
//      (Turnkey sub-section under "If you are using CDP / Privy / Turnkey / OWS")
//   5. Calls signer.signTypedData(payload) — the body forwards to viem's walletClient.signTypedData
//   6. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, PAYMENT_REQUIRED_FIXTURE } from './helpers.mjs';

test('Turnkey: documented signer wrapper produces a valid EIP-712 signature', { timeout: 30_000 }, async () => {
  // TURNKEY_SIGN_WITH is both the wallet address and the signing identity
  const missing = ['TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY', 'TURNKEY_ORGANIZATION_ID', 'TURNKEY_SIGN_WITH'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run Turnkey tests: ${missing.join(', ')}`);

  const { code, stdout } = await run('sign-x402-payment.mjs', ['payload', '--requirements', PAYMENT_REQUIRED_FIXTURE]);
  assert.equal(code, 0, 'payload command should succeed');

  const payload = JSON.parse(stdout);
  payload.message.from = process.env.TURNKEY_SIGN_WITH;
  // BigInt fields (validAfter, validBefore, value) come out as strings from JSON — convert back
  payload.message.validAfter  = BigInt(payload.message.validAfter);
  payload.message.validBefore = BigInt(payload.message.validBefore);
  payload.message.value       = BigInt(payload.message.value);

  const { createAccount }  = await import('@turnkey/viem');
  const { TurnkeyClient }  = await import('@turnkey/http');
  const { ApiKeyStamper }  = await import('@turnkey/api-key-stamper');
  const { createWalletClient, http } = await import('viem');
  const { base }           = await import('viem/chains');

  const tkClient = new TurnkeyClient(
    { baseUrl: 'https://api.turnkey.com' },
    new ApiKeyStamper({
      apiPublicKey:  process.env.TURNKEY_API_PUBLIC_KEY,
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
    }),
  );

  const account = await createAccount({
    client:         tkClient,
    organizationId: process.env.TURNKEY_ORGANIZATION_ID,
    signWith:       process.env.TURNKEY_SIGN_WITH,
  });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  const signer = {
    address: process.env.TURNKEY_SIGN_WITH,
    signTypedData: async ({ domain, types, primaryType, message }) => {
      return walletClient.signTypedData({ account, domain, types, primaryType, message });
    },
  };

  const signature = await signer.signTypedData(payload);
  assert.match(signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
