// pay.mjs integration tests — exercises the full 402 payment flow using a local mock server.
// No real funds or network access needed; uses the well-known Hardhat/Anvil test key.
//
// Tests:
//   1. Exits 0 and prints the status when the server returns 200 immediately (no payment needed)
//   2. Exits 1 and prints usage when --url is not provided
//   3. Exits 1 when --max-price is not provided
//   4. Exits 1 with "requires a value" when --max-price flag has no value
//   5. Exits 1 with a clear error on invalid --max-price format
//   6. Exits 1 with "No private key" when no key is available in env or args
//   7. Handles the full v1 402 flow (requirements in JSON body, X-PAYMENT header)
//   8. POST with --body sends the body to the server and handles 402 → retry
//   9. Exits 1 with rejection message when price exceeds --max-price
//  10. Proceeds normally when price is within --max-price
//  11. Fails closed when 402 requirements cannot be decoded
//  12. Enforces --max-price against the library's re-probe (price raised after initial probe)
//  13. Handles the full v2 402 flow (requirements in payment-required header, PAYMENT-SIGNATURE header)
//  14. Rejects when cheapest Base option passes but most expensive exceeds --max-price

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, TEST_KEY } from './helpers.mjs';
import http from 'http';

// Start a local HTTP server that returns a controlled response.
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('pay: exits 0 when server returns 200', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const { code, stdout } = await run('pay.mjs', ['--url', url, '--max-price', '0.01', '--key', TEST_KEY]);
    assert.equal(code, 0);
    assert.match(stdout, /200/);
  } finally {
    server.close();
  }
});

test('pay: errors with no --url', async () => {
  const { code, stderr } = await run('pay.mjs', ['--key', TEST_KEY]);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('pay: errors with no --max-price', async () => {
  const { code, stderr } = await run('pay.mjs', ['--url', 'http://localhost:1', '--key', TEST_KEY]);
  assert.equal(code, 1);
  assert.match(stderr, /--max-price.*required/i);
});

test('pay: errors when --max-price flag has no value', async () => {
  const { code, stderr } = await run('pay.mjs', ['--url', 'http://localhost:1', '--max-price', '--key', TEST_KEY]);
  assert.equal(code, 1);
  assert.match(stderr, /--max-price requires a value/i);
});

test('pay: errors on invalid --max-price format', async () => {
  const { code, stderr } = await run('pay.mjs', ['--url', 'http://localhost:1', '--max-price', 'abc', '--key', TEST_KEY]);
  assert.equal(code, 1);
  assert.match(stderr, /Invalid --max-price/i);
});

test('pay: errors with no key', async () => {
  const { code, stderr } = await run('pay.mjs', ['--url', 'http://localhost:1', '--max-price', '0.01'],
    { X402_PRIVATE_KEY: '', PRIVATE_KEY: '', WALLET_PRIVATE_KEY: '', ETH_PRIVATE_KEY: '', AGENT_PRIVATE_KEY: '' });
  assert.equal(code, 1);
  assert.match(stderr, /No private key/i);
});

test('pay: handles 402 and sends signed retry', { timeout: 10_000 }, async () => {
  let retryHeaders;

  // Request 1 → 402 (our probe, displays price)
  // Request 2 → 402 (library's own probe)
  // Request 3 → 200 (library's signed retry)
  let requestCount = 0;
  const { server, url } = await startServer((req, res) => {
    requestCount++;
    if (requestCount <= 2) {
      const requirementsJson = JSON.stringify({
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
      });
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(requirementsJson);
    } else {
      retryHeaders = req.headers;
      res.writeHead(200);
      res.end(JSON.stringify({ paid: true }));
    }
  });

  try {
    const { code, stdout } = await run('pay.mjs', ['--url', url, '--max-price', '0.01', '--key', TEST_KEY]);
    assert.equal(code, 0);
    assert.match(stdout, /Payment required:.*USDC/i, 'should log price before paying');
    assert.ok(retryHeaders?.['x-payment'], 'retry should include X-PAYMENT header');

    // Verify the payment header decodes to valid JSON with a signature
    const decoded = JSON.parse(Buffer.from(retryHeaders['x-payment'], 'base64').toString('utf8'));
    assert.match(decoded.payload.signature, /^0x[0-9a-fA-F]{130}$/);
  } finally {
    server.close();
  }
});

test('pay: POST with --body sends body and handles 402 → retry', { timeout: 10_000 }, async () => {
  let receivedBody;
  let requestCount = 0;

  const { server, url } = await startServer((req, res) => {
    requestCount++;
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (requestCount <= 2) {
        const requirementsJson = JSON.stringify({
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
        });
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(requirementsJson);
      } else {
        receivedBody = body;
        res.writeHead(200);
        res.end(JSON.stringify({ paid: true }));
      }
    });
  });

  try {
    const { code } = await run('pay.mjs', [
      '--url', url, '--max-price', '0.01', '--method', 'POST', '--body', '{"key":"value"}', '--key', TEST_KEY,
    ]);
    assert.equal(code, 0);
    assert.equal(receivedBody, '{"key":"value"}', 'retry should re-send the original body');
  } finally {
    server.close();
  }
});

test('pay: rejects when price exceeds --max-price', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '10000', // $0.01
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      }],
    }));
  });

  try {
    const { code, stderr } = await run('pay.mjs', ['--url', url, '--key', TEST_KEY, '--max-price', '0.005']);
    assert.equal(code, 1);
    assert.match(stderr, /exceeds --max-price/i);
  } finally {
    server.close();
  }
});

test('pay: proceeds when price is within --max-price', { timeout: 10_000 }, async () => {
  let requestCount = 0;
  const { server, url } = await startServer((req, res) => {
    requestCount++;
    if (requestCount <= 2) {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '10000', // $0.01
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          payTo: '0x1234567890123456789012345678901234567890',
          maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2' },
        }],
      }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ paid: true }));
    }
  });

  try {
    const { code } = await run('pay.mjs', ['--url', url, '--key', TEST_KEY, '--max-price', '0.01']);
    assert.equal(code, 0);
  } finally {
    server.close();
  }
});

test('pay: fails closed when 402 requirements cannot be decoded', { timeout: 10_000 }, async () => {
  const { server, url } = await startServer((req, res) => {
    // 402 with no decodable requirements body or header
    res.writeHead(402);
    res.end('payment required');
  });

  try {
    const { code, stderr } = await run('pay.mjs', ['--url', url, '--max-price', '0.01', '--key', TEST_KEY]);
    assert.equal(code, 1);
    assert.match(stderr, /unable to verify.*fail closed/i);
  } finally {
    server.close();
  }
});

test('pay: enforces --max-price against library re-probe when price rises', { timeout: 10_000 }, async () => {
  let requestCount = 0;
  const { server, url } = await startServer((req, res) => {
    requestCount++;
    // Our probe sees $0.01; library's re-probe sees $0.02 — above the confirmed max
    const price = requestCount === 1 ? '10000' : '20000';
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: price,
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      }],
    }));
  });

  try {
    const { code, stderr } = await run('pay.mjs', ['--url', url, '--max-price', '0.01', '--key', TEST_KEY]);
    assert.equal(code, 1);
    assert.match(stderr, /exceeds --max-price/i);
  } finally {
    server.close();
  }
});

test('pay: rejects when most expensive Base option exceeds --max-price', { timeout: 10_000 }, async () => {
  // Server returns two Base options: $0.005 (under limit) and $0.02 (over limit).
  // Checking only opts[0] would pass; a correct guard must check the most expensive.
  const { server, url } = await startServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '5000', // $0.005 — under the $0.01 limit
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          payTo: '0x1234567890123456789012345678901234567890',
          maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2' },
        },
        {
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '20000', // $0.02 — over the $0.01 limit
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          payTo: '0x1234567890123456789012345678901234567890',
          maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2' },
        },
      ],
    }));
  });

  try {
    const { code, stderr } = await run('pay.mjs', ['--url', url, '--key', TEST_KEY, '--max-price', '0.01']);
    assert.equal(code, 1);
    assert.match(stderr, /exceeds --max-price/i);
  } finally {
    server.close();
  }
});

test('pay: handles v2 402 (requirements in payment-required header)', { timeout: 10_000 }, async () => {
  let retryHeaders;
  let requestCount = 0;

  const { server, url } = await startServer((req, res) => {
    requestCount++;
    if (requestCount <= 2) {
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
    } else {
      retryHeaders = req.headers;
      res.writeHead(200);
      res.end(JSON.stringify({ paid: true }));
    }
  });

  try {
    const { code, stdout } = await run('pay.mjs', ['--url', url, '--max-price', '0.01', '--key', TEST_KEY]);
    assert.equal(code, 0);
    assert.match(stdout, /Payment required:.*USDC/i, 'should log price before paying');
    // v2: library sends PAYMENT-SIGNATURE header (not X-PAYMENT which is v1)
    assert.ok(retryHeaders?.['payment-signature'], 'retry should include PAYMENT-SIGNATURE header');

    const decoded = JSON.parse(Buffer.from(retryHeaders['payment-signature'], 'base64').toString('utf8'));
    assert.match(decoded.payload.signature, /^0x[0-9a-fA-F]{130}$/);
  } finally {
    server.close();
  }
});
