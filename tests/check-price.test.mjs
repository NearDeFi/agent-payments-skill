// check-price.mjs tests — exercises the wallet-independent live-price preview using a
// local mock server. No funds, key, or network access needed.
//
// Tests:
//   1. Exits 1 and prints usage when no <url> is given
//   2. Decodes a v1 402 (requirements in JSON body) and prints the USDC price
//   3. Decodes a v2 402 (requirements in payment-required header) and prints the price
//   4. Reports "No payment required" (exit 0) when the server returns 200
//   5. Picks Base (8453) over other EVM networks when several are offered

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.mjs';
import http from 'http';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('check-price: errors with no url', async () => {
  const { code, stderr } = await run('check-price.mjs', []);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('check-price: decodes v1 402 (JSON body)', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '10000',
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      }],
    }));
  });

  try {
    const { code, stdout } = await run('check-price.mjs', [url]);
    assert.equal(code, 0);
    assert.match(stdout, /Payment required:\s*0\.010000 USDC/i);
    assert.match(stdout, /network base/i);
  } finally {
    server.close();
  }
});

test('check-price: decodes v2 402 (payment-required header)', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    const requirements = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '10000',
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      }],
    })).toString('base64');
    res.writeHead(402, { 'payment-required': requirements });
    res.end();
  });

  try {
    const { code, stdout } = await run('check-price.mjs', [url]);
    assert.equal(code, 0);
    assert.match(stdout, /Payment required:\s*0\.010000 USDC/i);
  } finally {
    server.close();
  }
});

test('check-price: reports no payment required on 200', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const { code, stdout } = await run('check-price.mjs', [url]);
    assert.equal(code, 0);
    assert.match(stdout, /No payment required/i);
  } finally {
    server.close();
  }
});

test('check-price: prefers Base over other EVM networks', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [
        { scheme: 'exact', network: 'eip155:137', maxAmountRequired: '20000', asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 },
        { scheme: 'exact', network: 'base',        maxAmountRequired: '10000', asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 },
      ],
    }));
  });

  try {
    const { code, stdout } = await run('check-price.mjs', [url]);
    assert.equal(code, 0);
    // First line should be the Base option (sorted ahead of Polygon)
    assert.match(stdout.split('\n')[0], /network base/i);
  } finally {
    server.close();
  }
});
