#!/usr/bin/env node
// Preview the live x402 price for an endpoint WITHOUT paying — wallet-independent.
//
// Reads the 402 payment requirements (price, network, scheme) directly from the live
// endpoint. No wallet, key, or signing is involved: the 402 challenge is returned
// unauthenticated, so this works the same for every wallet. 
// Use it to show the price before paying (SKILL.md Step 5).
//
// Usage:
//   node scripts/check-price.mjs <url> [--method GET|POST] [--body <json>]

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : null;
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}
const method = (getArg('--method') || 'GET').toUpperCase();
const body   = getArg('--body');

if (!url) {
  console.error('Usage: node scripts/check-price.mjs <url> [--method GET|POST] [--body <json>]');
  process.exit(1);
}

const CHAIN_IDS = { 'base': 8453 }; // Solana can be added here in the future 
function evmChainId(network) {
  if (network?.startsWith('eip155:')) return parseInt(network.split(':')[1], 10);
  return CHAIN_IDS[network] ?? null;
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
  .filter(a => a.scheme === 'exact' && evmChainId(a.network) !== null)
  .sort((a, b) => {
    const aMain = evmChainId(a.network) === 8453 ? 0 : 1;
    const bMain = evmChainId(b.network) === 8453 ? 0 : 1;
    if (aMain !== bMain) return aMain - bMain;
    return parseInt(a.maxAmountRequired || a.amount || 0) - parseInt(b.maxAmountRequired || b.amount || 0);
  });

if (!evmOptions.length) {
  console.error('HTTP 402 returned but no exact-scheme EVM payment option was found.');
  process.exit(1);
}

for (const opt of evmOptions) {
  const amount = opt.maxAmountRequired || opt.amount;
  console.log(`Payment required: ${(parseInt(amount, 10) / 1e6).toFixed(6)} USDC on network ${opt.network} (atomic: ${amount})`);
}
