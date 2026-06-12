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
import {
  formatUsdc, parseUsdcToAtomic, optionAmount,
  isVerifiableBaseUsdcOption, baseUsdcOptions,
} from './x402-options.mjs';
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
const maxAtomic = parseUsdcToAtomic(maxPriceArg);
if (maxAtomic === null) {
  console.error(`Invalid --max-price value: ${maxPriceArg}. Expected a USDC amount like 0.0100 (up to 6 decimals).`);
  process.exit(1);
}
if (!keyArg) {
  console.error('No private key. Set X402_PRIVATE_KEY env var or pass --key <hex>.');
  process.exit(1);
}

// Initial probe to detect 402 and display price before paying
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

// Pre-flight price check on the verifiable Base USDC options. The payment itself is
// pinned to the cheapest such option by the selector below, so the cheapest one is
// the price that will actually be paid.
let priceVerified = false;
{
  const options = baseUsdcOptions(requirements?.accepts);
  if (options[0]) {
    const amount = optionAmount(options[0]);
    console.log(`Payment required: ${formatUsdc(amount)} USDC on network ${options[0].network}`);
    if (BigInt(amount) > maxAtomic) {
      console.error(`Payment rejected: price ${formatUsdc(amount)} USDC exceeds --max-price ${maxPriceArg} USDC.`);
      process.exit(1);
    }
    priceVerified = true;
  }
}

// Fail closed — if we couldn't decode the price requirements we cannot verify --max-price
if (!priceVerified) {
  console.error('Payment rejected: unable to verify the 402 price against --max-price (no Base USDC exact option, or undecodable requirements). Aborting to fail closed.');
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
    const opts = baseUsdcOptions(reqs.accepts);
    if (!opts[0]) throw new Error('Payment rejected: unable to verify 402 price (no Base USDC exact option). Aborting to fail closed.');
    const amount = optionAmount(opts[0]);
    if (BigInt(amount) > maxAtomic) throw new Error(`Payment rejected: price ${formatUsdc(amount)} USDC exceeds --max-price ${maxPriceArg} USDC.`);
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

  // Pin exactly which option the library pays. Its default selector takes the FIRST
  // supported option in *server order* — and the exact-evm scheme supports many EVM
  // networks — so a malicious server could list an expensive non-Base or non-USDC
  // option first to dodge a guard that only inspects Base USDC entries. This selector
  // only ever returns a verified Base USDC option within --max-price (the cheapest),
  // and throws (fail closed) when none qualifies.
  const selectVerifiedOption = (_version, accepts) => {
    const ok = baseUsdcOptions(accepts).filter(o => BigInt(optionAmount(o)) <= maxAtomic);
    if (!ok[0]) throw new Error(`Payment rejected: no Base USDC option within --max-price ${maxPriceArg} USDC.`);
    return ok[0];
  };

  const client = new x402Client(selectVerifiedOption);
  // Scope the v2 scheme registration to Base mainnet (default is the eip155:* wildcard).
  registerExactEvmScheme(client, { signer, networks: ['eip155:8453'] });
  // Last line of defence: re-verify whatever was actually selected right before signing.
  client.onBeforePaymentCreation(({ selectedRequirements: sel }) => {
    if (!isVerifiableBaseUsdcOption(sel) || BigInt(optionAmount(sel)) > maxAtomic) {
      return { abort: true, reason: `selected option is not Base USDC within --max-price ${maxPriceArg} USDC` };
    }
  });
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
