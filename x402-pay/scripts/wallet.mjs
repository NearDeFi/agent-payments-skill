#!/usr/bin/env node
// Wallet utilities for x402 payments (no extra dependencies beyond viem).
//
// Get wallet address from private key:
//   node scripts/wallet.mjs address [--key <hex>]
//
// Check USDC balance on Base:
//   node scripts/wallet.mjs balance <address> [--rpc <url>] [--rpc-key <key>]
//   Defaults to https://mainnet.base.org. --rpc-key is sent as `Authorization: Bearer <key>`.
//   Env fallbacks: BASE_RPC_URL, BASE_RPC_KEY.
//
// Generate a new private key:
//   node scripts/wallet.mjs new

import { randomBytes } from 'crypto';
import { loadEnv } from './load-env.mjs';
import { makeGetArg } from './cli-args.mjs';
loadEnv();

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const BASE_RPC_DEFAULT = 'https://mainnet.base.org';

const args = process.argv.slice(2);
const cmd  = args[0];
const getArg = makeGetArg(args);

function getKey() {
  return getArg('--key')
    || process.env.X402_PRIVATE_KEY
    || process.env.PRIVATE_KEY
    || process.env.WALLET_PRIVATE_KEY
    || process.env.ETH_PRIVATE_KEY
    || process.env.AGENT_PRIVATE_KEY;
}

function getRpcConfig() {
  const url = getArg('--rpc') || process.env.BASE_RPC_URL || BASE_RPC_DEFAULT;
  const key = getArg('--rpc-key') || process.env.BASE_RPC_KEY || null;
  return { url, key };
}

if (cmd === 'address') {
  const key = getKey();
  if (!key) {
    console.error('No private key. Set X402_PRIVATE_KEY env var or pass --key <hex>.');
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
  // Read USDC balanceOf(address) via viem — handles the eth_call, ABI encoding, and decoding.
  const { url, key } = getRpcConfig();
  const { createPublicClient, http, formatUnits, erc20Abi, getAddress } = await import('viem');
  // Normalize/validate the address — viem requires a 0x-prefixed, checksum-valid address.
  let target;
  try {
    target = getAddress(address.startsWith('0x') ? address : `0x${address}`);
  } catch {
    console.error(`Invalid address: ${address}`);
    process.exit(1);
  }
  const client = createPublicClient({
    transport: http(url, key ? { fetchOptions: { headers: { Authorization: `Bearer ${key}` } } } : undefined),
  });
  const raw = await client.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: 'balanceOf', args: [target] });
  const usd = formatUnits(raw, 6);
  const display = usd.includes('.') ? usd : `${usd}.000000`;
  console.log(`${display} USDC  (${raw} atomic units)`);

} else if (cmd === 'new') {
  const key = randomBytes(32).toString('hex');
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(`0x${key}`);
  console.log(`Private key: ${key}`);
  console.log(`Address:     ${account.address}`);
  console.log('\nStore the private key as X402_PRIVATE_KEY=<hex> in your .env file. Keep it out of version control.');

} else {
  console.log('Usage:');
  console.log('  node scripts/wallet.mjs address [--key <hex>]   Derive address from private key');
  console.log('  node scripts/wallet.mjs balance <address> [--rpc <url>] [--rpc-key <key>]');
  console.log('                                                   Check USDC balance on Base');
  console.log('  node scripts/wallet.mjs new                      Generate a new private key');
}
