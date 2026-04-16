#!/usr/bin/env node
// Wallet utilities for x402 payments (no extra dependencies beyond viem).
//
// Get wallet address from private key:
//   node scripts/wallet.mjs address [--key <hex>]
//
// Check USDC balance on Base:
//   node scripts/wallet.mjs balance <address>
//
// Generate a new private key:
//   node scripts/wallet.mjs new

import { randomBytes } from 'crypto';
import https from 'https';

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const BASE_RPC  = 'https://mainnet.base.org';

const args = process.argv.slice(2);
const cmd  = args[0];

function getKey() {
  const idx = args.indexOf('--key');
  return idx !== -1 ? args[idx + 1]
    : process.env.PRIVATE_KEY
    || process.env.WALLET_PRIVATE_KEY
    || process.env.ETH_PRIVATE_KEY;
}

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`RPC HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { return reject(new Error(`Invalid RPC JSON: ${e.message}`)); }
        if (parsed?.error) return reject(new Error(`RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
        resolve(parsed.result);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

if (cmd === 'address') {
  const key = getKey();
  if (!key) {
    console.error('No private key. Set PRIVATE_KEY env var or pass --key <hex>.');
    process.exit(1);
  }
  const { privateKeyToAccount } = await import('viem/accounts');
  const hexKey = key.startsWith('0x') ? key : `0x${key}`;
  const account = privateKeyToAccount(hexKey);
  console.log(account.address);

} else if (cmd === 'balance') {
  const address = args[1];
  if (!address) {
    console.error('Usage: node scripts/wallet.mjs balance <address>');
    process.exit(1);
  }
  // Call balanceOf(address) on the USDC contract
  const paddedAddr = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const data = `0x70a08231${paddedAddr}`;
  const result = await rpcCall('eth_call', [{ to: USDC_BASE, data }, 'latest']);
  const raw = BigInt(result);
  const { formatUnits } = await import('viem');
  const usd = formatUnits(raw, 6);
  const display = usd.includes('.') ? usd : `${usd}.000000`;
  console.log(`${display} USDC  (${raw} atomic units)`);

} else if (cmd === 'new') {
  const key = randomBytes(32).toString('hex');
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(`0x${key}`);
  console.log(`Private key: ${key}`);
  console.log(`Address:     ${account.address}`);
  console.log('\nStore the private key as PRIVATE_KEY=<hex> in your .env file. Keep it out of version control.');

} else {
  console.log('Usage:');
  console.log('  node scripts/wallet.mjs address [--key <hex>]   Derive address from private key');
  console.log('  node scripts/wallet.mjs balance <address>        Check USDC balance on Base');
  console.log('  node scripts/wallet.mjs new                      Generate a new private key');
}
