#!/usr/bin/env node
// Make a paid x402 request — handles 402 transparently via the @x402/fetch library.
// Supports v1 (body) and v2 (payment-required header) 402 responses using the exact-evm scheme.
//
// Usage:
//   node scripts/pay.mjs --url <url> [--method GET|POST] [--body <json>] [--key <hex>]
//
// Requires: npm install

import { loadEnv } from './load-env.mjs';
loadEnv();

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const urlArg  = getArg('--url');
const method  = (getArg('--method') || 'GET').toUpperCase();
const bodyArg = getArg('--body');
const keyArg  = getArg('--key') || process.env.X402_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ETH_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;

if (!urlArg) {
  console.error('Usage: node scripts/pay.mjs --url <url> [--method GET|POST] [--body <json>] [--key <hex>]');
  process.exit(1);
}
if (!keyArg) {
  console.error('No private key. Set X402_PRIVATE_KEY env var or pass --key <hex>.');
  process.exit(1);
}

// Initial probe to detect 402 and display price before paying
const CHAIN_IDS = { 'base': 8453, 'base-sepolia': 84532 };
function evmChainId(network) {
  if (network?.startsWith('eip155:')) return parseInt(network.split(':')[1], 10);
  return CHAIN_IDS[network] ?? null;
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

if (requirements?.accepts) {
  const evmOptions = requirements.accepts
    .filter(a => a.scheme === 'exact' && evmChainId(a.network) !== null)
    .sort((a, b) => {
      const aMain = evmChainId(a.network) === 8453 ? 0 : 1;
      const bMain = evmChainId(b.network) === 8453 ? 0 : 1;
      if (aMain !== bMain) return aMain - bMain;
      return parseInt(a.maxAmountRequired || a.amount || 0) - parseInt(b.maxAmountRequired || b.amount || 0);
    });
  const accepted = evmOptions[0];
  if (accepted) {
    const amount = accepted.maxAmountRequired || accepted.amount;
    console.log(`Payment required: ${(parseInt(amount, 10) / 1e6).toFixed(6)} USDC on network ${accepted.network}`);
  }
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
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

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
