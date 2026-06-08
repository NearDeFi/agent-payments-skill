#!/usr/bin/env node
// Preview the live x402 price for an endpoint WITHOUT paying — wallet-independent.
//
// Reads the 402 payment requirements (price, network, scheme) directly from the live
// endpoint. No wallet, key, or signing is involved: the 402 challenge is returned
// unauthenticated, so this works the same for every wallet. 
// Use it in Step 3 to preview the price (informs the Step 4 balance check and funding amount) and again before paying in Step 5.
//
// Usage:
//   node scripts/check-price.mjs <url> [--method GET|POST] [--body <json>]

import { makeGetArg } from './cli-args.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : null;
const getArg = makeGetArg(args);
const method = (getArg('--method') || 'GET').toUpperCase();
const body   = getArg('--body');

if (!url) {
  console.error('Usage: node scripts/check-price.mjs <url> [--method GET|POST] [--body <json>]');
  process.exit(1);
}

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

const reqHeaders = body ? { 'Content-Type': 'application/json' } : {};
let probe;
try {
  probe = await fetch(url, { method, headers: reqHeaders, body: body || undefined });
} catch (e) {
  console.error(`Request failed: ${e.message}`);
  process.exit(1);
}

if (probe.status !== 402) {
  console.log(`No payment required — endpoint returned status ${probe.status}.`);
  process.exit(0);
}

// Decode payment requirements: v1 = JSON body, v2 = base64 payment-required header.
let requirements = null;
const probeText = await probe.text();
try { requirements = JSON.parse(probeText); } catch {}
if (!requirements?.accepts) {
  const hdr = probe.headers.get('payment-required');
  if (hdr) try { requirements = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch {}
}

if (!requirements?.accepts) {
  console.error('Got HTTP 402 but could not decode payment requirements.');
  process.exit(1);
}

const evmOptions = requirements.accepts
  .filter(a => a.scheme === 'exact' && evmChainId(a.network) === BASE_MAINNET_CHAIN_ID)
  .sort((a, b) => {
    const av = BigInt(a.maxAmountRequired || a.amount || 0);
    const bv = BigInt(b.maxAmountRequired || b.amount || 0);
    return av < bv ? -1 : av > bv ? 1 : 0;   // cheapest first
  });

if (!evmOptions.length) {
  console.error('HTTP 402 returned but no exact-scheme Base mainnet payment option was found.');
  process.exit(1);
}

for (const opt of evmOptions) {
  const amount = opt.maxAmountRequired || opt.amount;
  console.log(`Payment required: ${formatUsdc(amount)} USDC on network ${opt.network} (atomic: ${amount})`);
}
