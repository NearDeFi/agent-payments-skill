// OWS signing test exercising the documented wallet-flows.md OWS snippet end-to-end.
// Imports the test private key into a fresh OWS vault, builds the documented signer
// (with the EIP712Domain injection, eip155:1 account lookup, and 0x-prefix handling
// quirks), then plugs it into wrapFetchWithPayment against a 402 mock server.
//
// The only deviation from the doc snippet is that every OWS call here passes an
// explicit `vaultPathOpt` pointing at a per-test temp dir — so the test doesn't
// touch the user's real wallet vault. End-users running the snippet as-is omit
// that argument and use the default vault.
//
// Asserts:
//   1. The wrapper fires the documented signer body (the OWS quirks above)
//   2. wrapFetchWithPayment intercepts 402 and retries with a PAYMENT-SIGNATURE header
//   3. Exactly 2 HTTP requests are made (initial + signed retry)
//   4. The retry signature is a valid 65-byte hex string with 0x prefix
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { TEST_KEY, PAYMENT_REQUIRED_V2_FIXTURE } from './helpers.mjs';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { importWalletPrivateKey, getWallet, signTypedData as owsSignTypedData } from '@open-wallet-standard/core';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('OWS: documented signer body produces a valid signed retry via wrapFetchWithPayment', { timeout: 10_000 }, async () => {
  // Per-test temp vault — keeps OWS state isolated and out of the user's real wallet store.
  const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-test-'));
  importWalletPrivateKey('my-agent', TEST_KEY.replace(/^0x/, ''), undefined, VAULT);

  let retryHeaders;
  let requestCount = 0;

  const { server, url } = await startServer((req, res) => {
    requestCount++;
    if (requestCount === 1) {
      res.writeHead(402, { 'payment-required': PAYMENT_REQUIRED_V2_FIXTURE });
      res.end();
    } else {
      retryHeaders = req.headers;
      res.writeHead(200);
      res.end(JSON.stringify({ paid: true }));
    }
  });

  try {
    // ── Documented OWS signer body (verbatim from references/wallet-flows.md, plus VAULT) ──
    const wallet = getWallet('my-agent', VAULT);
    // OWS accounts use eip155:1 — pick any EVM account (same address across all EVM chains)
    const evmAccount = wallet.accounts.find(a => a.chainId?.startsWith('eip155:'));

    const signer = {
      address: evmAccount.address,
      signTypedData: async ({ domain, types, primaryType, message }) => {
        const typesWithDomain = {
          EIP712Domain: [
            { name: 'name',              type: 'string'  },
            { name: 'version',           type: 'string'  },
            { name: 'chainId',           type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          ...types,
        };
        const { signature } = owsSignTypedData(
          'my-agent',
          'base',
          JSON.stringify(
            { domain, types: typesWithDomain, primaryType, message },
            (_, v) => typeof v === 'bigint' ? v.toString() : v,
          ),
          undefined, // passphrase
          undefined, // index
          VAULT,     // vaultPathOpt — test-only, default vault used by end-users
        );
        return signature.startsWith('0x') ? signature : `0x${signature}`;
      },
    };
    // ── End documented snippet ──

    const client = new x402Client();
    registerExactEvmScheme(client, { signer });
    const fetchWithPayment = wrapFetchWithPayment(fetch, client);

    const res = await fetchWithPayment(url);
    assert.equal(res.status, 200);
    assert.equal(requestCount, 2, 'expected exactly 2 requests (initial + retry)');
    assert.ok(retryHeaders?.['payment-signature'], 'retry should include PAYMENT-SIGNATURE header');

    const decoded = JSON.parse(Buffer.from(retryHeaders['payment-signature'], 'base64').toString('utf8'));
    assert.ok(decoded.payload?.signature, 'missing signature in payment payload');
    assert.match(decoded.payload.signature, /^0x[0-9a-fA-F]{130}$/, 'signature should be 65 bytes');
  } finally {
    server.close();
    fs.rmSync(VAULT, { recursive: true, force: true });
  }
});
