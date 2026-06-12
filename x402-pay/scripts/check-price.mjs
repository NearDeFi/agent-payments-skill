#!/usr/bin/env node
// Preview the live x402 price for an endpoint WITHOUT paying — wallet-independent.
//
// Reads the 402 payment requirements (price, network, scheme) directly from the live
// endpoint. No wallet, key, or signing is involved: the 402 challenge is returned
// unauthenticated, so this works the same for every wallet.
// Use it in Step 3 to preview the price (informs the Step 4 balance check and funding amount) and again before paying in Step 5.
//
// Usage:
//   node scripts/check-price.mjs <url> [--method GET|POST] [--body <json>] [--max-price <usdc>]

import { makeGetArg } from './cli-args.mjs';
import { formatUsdc, parseUsdcToAtomic, optionAmount, baseUsdcOptions } from './x402-options.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : null;
const getArg = makeGetArg(args);
const method      = (getArg('--method') || 'GET').toUpperCase();
const body        = getArg('--body');
const maxPriceArg = getArg('--max-price');

if (!url) {
  console.error('Usage: node scripts/check-price.mjs <url> [--method GET|POST] [--body <json>] [--max-price <usdc>]');
  process.exit(1);
}
if (args.includes('--max-price') && maxPriceArg === null) {
  console.error('--max-price requires a value (e.g. --max-price 0.0100).');
  process.exit(1);
}
let maxAtomic = null;
if (maxPriceArg !== null) {
  maxAtomic = parseUsdcToAtomic(maxPriceArg);
  if (maxAtomic === null) {
    console.error(`Invalid --max-price value: ${maxPriceArg}. Expected a USDC amount like 0.0100 (up to 6 decimals).`);
    process.exit(1);
  }
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

// Same filter pay.mjs uses: exact scheme, Base mainnet, Base USDC asset — so the
// prices printed here are exactly the options pay.mjs would consider paying.
const evmOptions = baseUsdcOptions(requirements.accepts);

if (!evmOptions.length) {
  console.error('HTTP 402 returned but no exact-scheme Base mainnet USDC payment option was found.');
  process.exit(1);
}

for (const opt of evmOptions) {
  const amount = optionAmount(opt);
  console.log(`Payment required: ${formatUsdc(amount)} USDC on network ${opt.network} (atomic: ${amount})`);
}

// pay.mjs pays the cheapest verified option, so that is the price to check.
if (maxAtomic !== null) {
  const cheapestAmount = optionAmount(evmOptions[0]);
  if (BigInt(cheapestAmount) > maxAtomic) {
    console.error(`Price ${formatUsdc(cheapestAmount)} USDC exceeds --max-price ${maxPriceArg} USDC.`);
    process.exit(1);
  }
}
