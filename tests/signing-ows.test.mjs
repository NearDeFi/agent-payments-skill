// OWS / MoonPay signing test using @x402/fetch + ExactEvmScheme.
// Runs without credentials — uses the well-known Hardhat/Anvil test key, no real wallet needed.
//
// What this test does:
//   1. Starts a local HTTP server that returns 402 (with fixture payment requirements) on the
//      first request, then 200 on the second
//   2. Creates a viem account from the test private key (stands in for an OWS wallet signer)
//   3. Wraps fetch with wrapFetchWithPaymentFromConfig + ExactEvmScheme registered for eip155:8453
//   4. Makes a single fetch call — the wrapper intercepts the 402, builds and signs the EIP-712
//      payment authorization, and automatically retries with a PAYMENT-SIGNATURE header
//   5. Asserts the final response status is 200
//   6. Asserts exactly 2 HTTP requests were made (initial + signed retry)
//   7. Asserts the retry included a PAYMENT-SIGNATURE header containing a valid 65-byte signature
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { TEST_KEY, PAYMENT_REQUIRED_V2_FIXTURE } from './helpers.mjs';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('OWS: wrapFetchWithPaymentFromConfig handles 402 and sends signed retry', { timeout: 10_000 }, async () => {
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
    const account = privateKeyToAccount(TEST_KEY);
    const agentFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }],
    });

    const res = await agentFetch(url);
    assert.equal(res.status, 200);
    assert.equal(requestCount, 2, 'expected exactly 2 requests (initial + retry)');
    assert.ok(retryHeaders?.['payment-signature'], 'retry should include PAYMENT-SIGNATURE header');

    const decoded = JSON.parse(Buffer.from(retryHeaders['payment-signature'], 'base64').toString('utf8'));
    assert.ok(decoded.payload?.signature, 'missing signature in payment payload');
    assert.match(decoded.payload.signature, /^0x[0-9a-fA-F]{130}$/, 'signature should be 65 bytes');
  } finally {
    server.close();
  }
});
