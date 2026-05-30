// wallet.mjs tests — verifies address derivation, balance checking, and key generation.
//
// Tests:
//   1. address: derives the correct EVM address from the well-known test private key
//      (deterministic — asserts the exact expected address)
//   2. address (no key): exits 1 with an error when no private key is in env or args
//   3. balance: calls Base mainnet RPC to fetch the USDC balance of the test address
//      (live network call — asserts the output is a numeric USDC value)
//   4. balance (no address): exits 1 and prints usage when called without an address argument
//   5. new: generates a fresh random private key, prints "Private key:" and "Address:",
//      and the address matches the standard 0x + 40 hex char EVM format
//   6. balance --rpc: routes the eth_call to a custom RPC URL and parses its response
//   7. balance --rpc-key: sends the key as `Authorization: Bearer <key>` to the custom RPC

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { run, TEST_KEY, TEST_ADDRESS } from './helpers.mjs';

// Spin up a mock JSON-RPC server that records the incoming request and replies with
// `result` (a 32-byte hex word). Returns { url, getRequest, close }.
async function mockRpc(result) {
  let captured = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      captured = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: captured.body.id, result }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    getRequest: () => captured,
    close: () => new Promise(r => server.close(r)),
  };
}

test('wallet address: derives correct address from known key', async () => {
  const { code, stdout } = await run('wallet.mjs', ['address'], { X402_PRIVATE_KEY: TEST_KEY });
  assert.equal(code, 0);
  assert.equal(stdout, TEST_ADDRESS);
});

test('wallet address: errors with no key', async () => {
  const { code, stderr } = await run('wallet.mjs', ['address'], {
    X402_PRIVATE_KEY: '', PRIVATE_KEY: '', WALLET_PRIVATE_KEY: '', ETH_PRIVATE_KEY: '',
  });
  assert.equal(code, 1);
  assert.match(stderr, /No private key/i);
});

test('wallet balance: returns USDC balance for a valid address', { timeout: 10_000 }, async () => {
  const { code, stdout } = await run('wallet.mjs', ['balance', TEST_ADDRESS]);
  assert.equal(code, 0);
  assert.match(stdout, /\d+\.\d+ USDC/);
});

test('wallet balance: errors with no address', async () => {
  const { code, stderr } = await run('wallet.mjs', ['balance']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage/i);
});

test('wallet balance: routes to custom --rpc url', async () => {
  // 1234567 atomic units = 1.234567 USDC, encoded as a 32-byte hex word
  const result = '0x' + (1234567n).toString(16).padStart(64, '0');
  const rpc = await mockRpc(result);
  try {
    const { code, stdout } = await run('wallet.mjs', ['balance', TEST_ADDRESS, '--rpc', rpc.url]);
    assert.equal(code, 0);
    assert.match(stdout, /1\.234567 USDC/);
    const req = rpc.getRequest();
    assert.equal(req.body.method, 'eth_call');
    assert.equal(req.body.params[0].to.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    assert.equal(req.headers.authorization, undefined);
  } finally {
    await rpc.close();
  }
});

test('wallet balance: --rpc-key sends Authorization: Bearer header', async () => {
  const result = '0x' + (0n).toString(16).padStart(64, '0');
  const rpc = await mockRpc(result);
  try {
    const { code } = await run('wallet.mjs', [
      'balance', TEST_ADDRESS, '--rpc', rpc.url, '--rpc-key', 'test-secret-key',
    ]);
    assert.equal(code, 0);
    assert.equal(rpc.getRequest().headers.authorization, 'Bearer test-secret-key');
  } finally {
    await rpc.close();
  }
});

test('wallet new: generates a key and address', async () => {
  const { code, stdout } = await run('wallet.mjs', ['new']);
  assert.equal(code, 0);
  assert.match(stdout, /Private key:/);
  assert.match(stdout, /Address:/);
  assert.match(stdout, /0x[0-9a-fA-F]{40}/);
});
