// Shared signer-template test — exercises the "Managed signer wallets" snippet from
// references/wallet-flows.md verbatim: a custom `signer = { address, signTypedData }`
// plugged into `wrapFetchWithPayment` via `registerExactEvmScheme`, with the MAX_PRICE
// guard (pinned selector + before-payment hook), run against a local mock 402. This is
// the seam the per-wallet signing tests don't cover — they call signTypedData directly,
// never through the library's 402 → build payload → sign → retry handshake. The signer
// here signs with the Hardhat test key, standing in for the CDP/Privy/Turnkey
// wallet-specific bodies. No credentials or network needed.
//
// Tests:
//   1. Custom signer flows through wrapFetchWithPayment and pays when the quote is within MAX_PRICE
//   2. Fails closed without signing when the payment-time quote exceeds MAX_PRICE
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TEST_KEY, TEST_ADDRESS } from './helpers.mjs';

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// Build the wallet-flows template client around a signer, with viem standing in for
// the wallet-specific signTypedData call. Mirrors the snippet line for line.
async function templateFetch(MAX_PRICE) {
  const { privateKeyToAccount } = await import('viem/accounts');
  const { x402Client, wrapFetchWithPayment } = await import('@x402/fetch');
  const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
  const { parseUsdcToAtomic, optionAmount, isVerifiableBaseUsdcOption, baseUsdcOptions } =
    await import('../x402-pay/scripts/x402-options.mjs');

  const maxAtomic = parseUsdcToAtomic(MAX_PRICE);
  if (maxAtomic === null) throw new Error(`Invalid MAX_PRICE: ${MAX_PRICE}`);

  const account = privateKeyToAccount(TEST_KEY);
  const signer = {
    address: account.address,
    signTypedData: async ({ domain, types, primaryType, message }) =>
      account.signTypedData({ domain, types, primaryType, message }),
  };

  const client = new x402Client((_version, accepts) => {
    const ok = baseUsdcOptions(accepts).filter(o => BigInt(optionAmount(o)) <= maxAtomic);
    if (!ok[0]) throw new Error(`Payment rejected: no Base USDC option within ${MAX_PRICE} USDC.`);
    return ok[0];
  });
  registerExactEvmScheme(client, { signer, networks: ['eip155:8453'] });
  client.onBeforePaymentCreation(({ selectedRequirements: sel }) => {
    if (!isVerifiableBaseUsdcOption(sel) || BigInt(optionAmount(sel)) > maxAtomic) {
      return { abort: true, reason: `selected option is not Base USDC within ${MAX_PRICE} USDC` };
    }
  });
  return wrapFetchWithPayment(fetch, client);
}

test('signer template: custom signer flows through wrapFetchWithPayment and pays', { timeout: 10_000 }, async () => {
  // Mock endpoint: 402 until a request carries X-PAYMENT, then 200 with the paid body.
  let retryHeaders;
  const { server, url } = await startServer((req, res) => {
    if (req.headers['x-payment']) {
      retryHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paid: true }));
    } else {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '10000', // $0.01 — within MAX_PRICE
          asset: USDC_BASE,
          payTo: '0x1234567890123456789012345678901234567890',
          maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2' },
        }],
      }));
    }
  });

  try {
    const fetchWithPayment = await templateFetch('0.01');
    const res = await fetchWithPayment(url);
    assert.equal(res.status, 200, 'should reach the paid 200 response');
    assert.deepEqual(await res.json(), { paid: true }, 'should return the paid body');

    // The library built the payload from the 402, signed it with our custom signer,
    // and packed it into X-PAYMENT.
    assert.ok(retryHeaders?.['x-payment'], 'retry should carry an X-PAYMENT header');
    const decoded = JSON.parse(Buffer.from(retryHeaders['x-payment'], 'base64').toString('utf8'));
    assert.match(decoded.payload.signature, /^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte signature');
    assert.equal(
      decoded.payload.authorization.from.toLowerCase(),
      TEST_ADDRESS.toLowerCase(),
      'authorization.from should be the custom signer address',
    );
  } finally {
    server.close();
  }
});

test('signer template: fails closed when the payment-time quote exceeds MAX_PRICE', { timeout: 10_000 }, async () => {
  // The server quotes $0.02 at payment time — above the $0.01 the user confirmed.
  let sawPayment = false;
  const { server, url } = await startServer((req, res) => {
    if (req.headers['x-payment']) sawPayment = true;
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '20000', // $0.02 — over MAX_PRICE
        asset: USDC_BASE,
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      }],
    }));
  });

  try {
    const fetchWithPayment = await templateFetch('0.01');
    await assert.rejects(
      () => fetchWithPayment(url),
      /no Base USDC option within 0\.01 USDC/,
      'must reject instead of paying the raised quote',
    );
    assert.equal(sawPayment, false, 'no signed payment must ever be sent');
  } finally {
    server.close();
  }
});
