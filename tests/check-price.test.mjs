// check-price.mjs tests — exercises the wallet-independent live-price preview using a
// local mock server. No funds, key, or network access needed.
//
// Tests:
//   1. Exits 1 and prints usage when no <url> is given
//   2. Decodes a v1 402 (requirements in JSON body) and prints the USDC price
//   3. Decodes a v2 402 (requirements in payment-required header) and prints the price
//   4. Reports "No payment required" (exit 0) when the server returns 200
//   5. Includes only Base mainnet — excludes testnets and other EVM chains
//   6. Sorts cheapest-first using BigInt (no precision loss on huge amounts)

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

test('check-price: includes only Base mainnet, excludes other EVM networks', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [
        { scheme: 'exact', network: 'eip155:137',   maxAmountRequired: '20000', asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 }, // Polygon
        { scheme: 'exact', network: 'eip155:84532', maxAmountRequired: '5000',  asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 }, // Base Sepolia
        { scheme: 'exact', network: 'base',         maxAmountRequired: '10000', asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 }, // Base mainnet
      ],
    }));
  });

  try {
    const { code, stdout } = await run('check-price.mjs', [url]);
    assert.equal(code, 0);
    const lines = stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'only the Base mainnet option should be listed');
    assert.match(lines[0], /network base/i);
    assert.doesNotMatch(stdout, /eip155|137|84532/, 'non-Base-mainnet networks must be excluded');
  } finally {
    server.close();
  }
});

test('check-price: sorts cheapest-first with BigInt precision', { timeout: 10_000 }, async () => {
  // Two Base mainnet options whose amounts differ only beyond Number's safe-integer
  // range (2^53). The cheaper one (…992) is listed second; a parseInt/Number sort
  // would round both to the same value and leave them in input order, so this fails
  // unless the comparison uses BigInt.
  const { server, url } = await startServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [
        { scheme: 'exact', network: 'base', maxAmountRequired: '9007199254740993', asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 }, // 2^53 + 1 (dearer)
        { scheme: 'exact', network: 'base', maxAmountRequired: '9007199254740992', asset: '0x0', payTo: '0x1', maxTimeoutSeconds: 60 }, // 2^53     (cheaper)
      ],
    }));
  });

  try {
    const { code, stdout } = await run('check-price.mjs', [url]);
    assert.equal(code, 0);
    const lines = stdout.trim().split('\n').filter(Boolean);
    assert.match(lines[0], /atomic: 9007199254740992\b/, 'cheaper option must sort first');
    assert.match(lines[1], /atomic: 9007199254740993\b/);
  } finally {
    server.close();
  }
});
