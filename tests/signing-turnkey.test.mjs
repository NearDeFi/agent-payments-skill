// Turnkey signing test using @turnkey/sdk-server + @turnkey/viem.
// Requires: TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID, TURNKEY_SIGN_WITH
//
// What this test does:
//   1. Fails immediately with a list of missing env vars if credentials are not set
//   2. Takes the static EIP-712 payload fixture (the shape @x402/fetch hands the signer)
//   3. Builds the signer object exactly as documented in references/wallet-flows.md
//      (Turnkey sub-section under "Managed signer wallets: CDP, Privy, Turnkey")
//   4. Calls signer.signTypedData(payload) — signs via @turnkey/viem's walletClient
//      (Turnkey API client + a viem wallet account on Base)
//   5. Asserts the returned signature is a valid 65-byte hex string (0x + 130 chars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_PAYLOAD_FIXTURE } from './helpers.mjs';

test('Turnkey: documented signer wrapper produces a valid EIP-712 signature', { timeout: 30_000 }, async () => {
  // TURNKEY_SIGN_WITH is both the wallet address and the signing identity
  const missing = ['TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY', 'TURNKEY_ORGANIZATION_ID', 'TURNKEY_SIGN_WITH'].filter(k => !process.env[k]);
  assert.equal(missing.length, 0, `Missing env vars — set these in .env to run Turnkey tests: ${missing.join(', ')}`);

  const payload = structuredClone(PAYMENT_PAYLOAD_FIXTURE);
  payload.message.from = process.env.TURNKEY_SIGN_WITH;
  // value/validAfter/validBefore are already BigInt in the fixture (viem requires BigInt for uint256).

  const { createAccount }            = await import('@turnkey/viem');
  const { Turnkey }                  = await import('@turnkey/sdk-server');
  const { createWalletClient, http } = await import('viem');
  const { base }                     = await import('viem/chains');

  const turnkey = new Turnkey({
    apiBaseUrl:            'https://api.turnkey.com',
    apiPublicKey:          process.env.TURNKEY_API_PUBLIC_KEY,
    apiPrivateKey:         process.env.TURNKEY_API_PRIVATE_KEY,
    defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID,
  });
  const account = await createAccount({
    client:         turnkey.apiClient(),
    organizationId: process.env.TURNKEY_ORGANIZATION_ID,
    signWith:       process.env.TURNKEY_SIGN_WITH,
  });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  const signer = {
    address: process.env.TURNKEY_SIGN_WITH,
    signTypedData: async ({ domain, types, primaryType, message }) => {
      return walletClient.signTypedData({ domain, types, primaryType, message });
    },
  };

  const signature = await signer.signTypedData(payload);
  assert.match(signature, /^0x[0-9a-fA-F]{130}$/, 'expected 65-byte signature');
});
