#!/usr/bin/env node
// Make a paid x402 request using a raw private key.
// Handles the full flow: fetch → 402 → sign → retry.
//
// Usage:
//   node scripts/pay.mjs --url <url> [--method GET|POST] [--body <json>] [--key <hex>]
//
// Requires: npm install viem

import https from 'https';
import http from 'http';
import { randomBytes } from 'crypto';

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const urlArg    = getArg('--url');
const method    = (getArg('--method') || 'GET').toUpperCase();
const bodyArg   = getArg('--body');
const keyArg    = getArg('--key') || process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ETH_PRIVATE_KEY;

if (!urlArg) {
  console.error('Usage: node scripts/pay.mjs --url <url> [--method GET|POST] [--body <json>] [--key <hex>]');
  process.exit(1);
}
if (!keyArg) {
  console.error('No private key. Set PRIVATE_KEY env var or pass --key <hex>.');
  process.exit(1);
}

// x402 v1 uses short network names; v0 used eip155:<chainId>
const CHAIN_IDS = { 'base': 8453, 'base-sepolia': 84532 };

function evmChainId(network) {
  if (network?.startsWith('eip155:')) return parseInt(network.split(':')[1], 10);
  return CHAIN_IDS[network] ?? null;
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = options.body || null;

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Initial request
const initial = await makeRequest(urlArg, { method, body: bodyArg });

if (initial.status !== 402) {
  console.log(`Status: ${initial.status}`);
  console.log(initial.body);
  process.exit(initial.status >= 200 && initial.status < 300 ? 0 : 1);
}

// Decode payment requirements — v1: JSON body, v2: payment-required header (base64)
let requirements = null;
try { requirements = JSON.parse(initial.body); } catch {}
if (!requirements?.accepts) {
  const hdr = initial.headers['payment-required'];
  if (!hdr) {
    console.error('Got 402 but no payment requirements found in body or payment-required header.');
    process.exit(1);
  }
  try { requirements = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); }
  catch { console.error('Failed to decode payment-required header.'); process.exit(1); }
}

const accepted = (requirements.accepts || []).find(a => evmChainId(a.network) !== null);
if (!accepted) {
  console.error('No EVM payment method in requirements. Only base and base-sepolia are supported.');
  process.exit(1);
}

const amount      = accepted.maxAmountRequired || accepted.amount;
const amountUsd   = (parseInt(amount, 10) / 1e6).toFixed(6);
console.log(`Payment required: ${amountUsd} USDC on network ${accepted.network}`);

// Build EIP-712 TransferWithAuthorization payload
const chainId      = evmChainId(accepted.network);
const tokenName    = accepted.extra?.name    || accepted.extra?.tokenName    || 'USD Coin';
const tokenVersion = accepted.extra?.version || accepted.extra?.tokenVersion || '2';
const now          = Math.floor(Date.now() / 1000);
const validAfter   = BigInt(now - 5);
const validBefore  = BigInt(now + (accepted.maxTimeoutSeconds || 60));
const nonce        = '0x' + randomBytes(32).toString('hex');

const domain = {
  name: tokenName,
  version: tokenVersion,
  chainId,
  verifyingContract: accepted.asset,
};

const types = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
};

// Sign
const { privateKeyToAccount } = await import('viem/accounts');
const hexKey  = keyArg.startsWith('0x') ? keyArg : `0x${keyArg}`;
const account = privateKeyToAccount(hexKey);

const message = {
  from:        account.address,
  to:          accepted.payTo,
  value:       BigInt(amount),
  validAfter,
  validBefore,
  nonce,
};

const signature = await account.signTypedData({
  domain, types, primaryType: 'TransferWithAuthorization', message,
});

// Build X-PAYMENT header
const payment = {
  x402Version: requirements.x402Version || 1,
  scheme:  accepted.scheme,
  network: accepted.network,
  payload: {
    signature,
    authorization: {
      from:        account.address,
      to:          accepted.payTo,
      value:       amount,
      validAfter:  validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  },
};

const paymentHeader = Buffer.from(JSON.stringify(payment)).toString('base64');

// Retry with payment
const result = await makeRequest(urlArg, {
  method,
  body: bodyArg,
  headers: { 'X-PAYMENT': paymentHeader },
});

console.log(`Status: ${result.status}`);
console.log(result.body);
