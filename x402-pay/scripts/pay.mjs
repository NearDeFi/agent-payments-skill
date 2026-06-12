#!/usr/bin/env node
// Make a paid x402 request — handles 402 transparently via the @x402/fetch library.
// Supports v1 (body) and v2 (payment-required header) 402 responses using the exact-evm scheme.
//
// Usage:
//   node scripts/pay.mjs --url <url> --max-price <usdc> [--method GET|POST] [--body <json>] [--key <hex>]
//
// Requires: npm install

import { loadEnv } from './load-env.mjs';
import { makeGetArg } from './cli-args.mjs';
loadEnv();

const args = process.argv.slice(2);
const getArg = makeGetArg(args);

const urlArg      = getArg('--url');
const method      = (getArg('--method') || 'GET').toUpperCase();
const bodyArg     = getArg('--body');
const keyArg      = getArg('--key') || process.env.X402_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ETH_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
const maxPriceArg = getArg('--max-price');

if (!urlArg) {
  console.error('Usage: node scripts/pay.mjs --url <url> --max-price <usdc> [--method GET|POST] [--body <json>] [--key <hex>]');
  process.exit(1);
}
if (args.includes('--max-price') && maxPriceArg === null) {
  console.error('--max-price requires a value (e.g. --max-price 0.0100).');
  process.exit(1);
}
if (maxPriceArg === null) {
  console.error('--max-price <usdc> is required. Preview the price with check-price.mjs, confirm with the user, then pass the confirmed price here.');
  process.exit(1);
}
const maxPriceMatch = maxPriceArg.match(/^(\d+)(?:\.(\d{1,6}))?$/);
if (!maxPriceMatch) {
  console.error(`Invalid --max-price value: ${maxPriceArg}. Expected a USDC amount like 0.0100 (up to 6 decimals).`);
  process.exit(1);
}
const maxAtomic = (BigInt(maxPriceMatch[1]) * 1_000_000n) + BigInt((maxPriceMatch[2] || '').padEnd(6, '0'));
if (!keyArg) {
  console.error('No private key. Set X402_PRIVATE_KEY env var or pass --key <hex>.');
  process.exit(1);
}

// Initial probe to detect 402 and display price before paying
const BASE_MAINNET_CHAIN_ID = 8453; // only Base mainnet is supported (no testnets / other chains)
const CHAIN_IDS = { 'base': BASE_MAINNET_CHAIN_ID };
// Normalize an x402 network field to its numeric EVM chain ID. Handles both the
// CAIP-2 form ("eip155:8453") and the short-name form ("base"); returns null for
// anything unrecognized.
function evmChainId(network) {
  if (network?.startsWith('eip155:')) return parseInt(network.split(':')[1], 10);
  return CHAIN_IDS[network] ?? null;
}

// Format an atomic USDC amount (6 decimals) as a decimal string, using BigInt so
// large values don't lose precision.
function formatUsdc(atomic) {
  const v = BigInt(atomic);
  return `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, '0')}`;
}

const reqHeaders = bodyArg ? { 'Content-Type': 'application/json' } : {};
let probe;
try {
  probe = await fetch(urlArg, { method, headers: reqHeaders, body: bodyArg || undefined });
} catch (e) {
  console.error(`Request failed: ${e.message}`);
  process.exit(1);
}

if (probe.status !== 402) {
  console.log(`Status: ${probe.status}`);
  console.log(await probe.text());
  process.exit(probe.ok ? 0 : 1);
}

// Decode payment requirements for price display
let requirements = null;
const probeText = await probe.text();
try { requirements = JSON.parse(probeText); } catch {}
if (!requirements?.accepts) {
  const hdr = probe.headers.get('payment-required');
  if (hdr) try { requirements = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch {}
}

let priceVerified = false;
if (requirements?.accepts) {
  const evmOptions = requirements.accepts
    .filter(a => a.scheme === 'exact' && evmChainId(a.network) === BASE_MAINNET_CHAIN_ID)
    .sort((a, b) => {
      const av = BigInt(a.maxAmountRequired || a.amount || 0);
      const bv = BigInt(b.maxAmountRequired || b.amount || 0);
      return av < bv ? -1 : av > bv ? 1 : 0;   // cheapest first
    });
  if (evmOptions[0]) {
    const displayAmount = evmOptions[0].maxAmountRequired || evmOptions[0].amount;
    const maxOpt = evmOptions[evmOptions.length - 1];
    const guardAmount = maxOpt.maxAmountRequired || maxOpt.amount;
    console.log(`Payment required: ${formatUsdc(displayAmount)} USDC on network ${evmOptions[0].network}`);
    if (BigInt(guardAmount) > maxAtomic) {
      console.error(`Payment rejected: price ${formatUsdc(guardAmount)} USDC exceeds --max-price ${maxPriceArg} USDC.`);
      process.exit(1);
    }
    priceVerified = true;
  }
}

// Fail closed — if we couldn't decode the price requirements we cannot verify --max-price
if (!priceVerified) {
  console.error('Payment rejected: unable to verify the 402 price against --max-price (unsupported scheme/network or undecodable requirements). Aborting to fail closed.');
  process.exit(1);
}

// Wrap fetch so the library's own 402 re-probe is also checked against --max-price.
// Clones each 402 response to decode requirements without consuming the body the library needs.
async function guardedFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 402) {
    const clone = response.clone();
    let reqs = null;
    try { reqs = JSON.parse(await clone.text()); } catch {}
    if (!reqs?.accepts) {
      const hdr = response.headers.get('payment-required');
      if (hdr) try { reqs = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch {}
    }
    if (!reqs?.accepts) throw new Error('Payment rejected: unable to verify 402 price (undecodable requirements). Aborting to fail closed.');
    const opts = reqs.accepts
      .filter(a => a.scheme === 'exact' && evmChainId(a.network) === BASE_MAINNET_CHAIN_ID)
      .sort((a, b) => { const av = BigInt(a.maxAmountRequired || a.amount || 0), bv = BigInt(b.maxAmountRequired || b.amount || 0); return av < bv ? -1 : av > bv ? 1 : 0; });
    if (!opts[0]) throw new Error('Payment rejected: unable to verify 402 price (no supported Base option). Aborting to fail closed.');
    const maxOpt = opts[opts.length - 1];
    const maxAmount = maxOpt.maxAmountRequired || maxOpt.amount;
    if (BigInt(maxAmount) > maxAtomic) throw new Error(`Payment rejected: price ${formatUsdc(maxAmount)} USDC exceeds --max-price ${maxPriceArg} USDC.`);
  }
  return response;
}

// Set up x402 client — handles all payment schemes and extensions automatically
try {
  const { privateKeyToAccount } = await import('viem/accounts');
  const { x402Client, wrapFetchWithPayment } = await import('@x402/fetch');
  const { registerExactEvmScheme } = await import('@x402/evm/exact/client');

  const hexKey = keyArg.startsWith('0x') ? keyArg : `0x${keyArg}`;
  const signer = privateKeyToAccount(hexKey);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  const fetchWithPayment = wrapFetchWithPayment(guardedFetch, client);

  // Library handles 402 → sign → retry transparently, including all extensions
  const result = await fetchWithPayment(urlArg, { method, headers: reqHeaders, body: bodyArg || undefined });
  console.log(`Status: ${result.status}`);
  console.log(await result.text());
  process.exit(result.ok ? 0 : 1);
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find package')) {
    console.error('Dependencies missing: npm install');
  } else {
    console.error('Payment failed:', e.message);
  }
  process.exit(1);
}
