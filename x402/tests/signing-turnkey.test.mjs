// Turnkey signing test using @turnkey/viem.
// Requires: TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID, TURNKEY_SIGN_WITH
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Runs sign-x402-payment.mjs payload to get an EIP-712 signing payload from the fixture requirements
//   3. Converts BigInt fields (validAfter, validBefore, value) from JSON strings back to BigInt
//      (required because JSON.parse cannot represent BigInt natively)
//   4. Creates a TurnkeyClient authenticated with ApiKeyStamper using the API key pair
//   5. Derives a viem-compatible account via createAccount() pointing at the signing address
//   6. Creates a viem WalletClient on Base mainnet and calls signTypedData with the EIP-712 payload
//   7. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, PAYMENT_REQUIRED_FIXTURE } from './helpers.mjs';

test('Turnkey: signs EIP-712 payload via @turnkey/viem', { timeout: 30_000 }, async () => {
  const missing = ['TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY', 'TURNKEY_ORGANIZATION_ID', 'TURNKEY_SIGN_WITH'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run Turnkey tests: ${missing.join(', ')}`);

  const { code, stdout } = await run('sign-x402-payment.mjs', ['payload', '--requirements', PAYMENT_REQUIRED_FIXTURE]);
  assert.equal(code, 0, 'payload command should succeed');

  const payload = JSON.parse(stdout);
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
    ethereumAddress: process.env.TURNKEY_SIGN_WITH,
  });

  const walletClient = createWalletClient({ account, chain: base, transport: http() });
  const signature = await walletClient.signTypedData({ account, ...payload });

  assert.match(signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
