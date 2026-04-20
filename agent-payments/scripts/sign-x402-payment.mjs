#!/usr/bin/env node
// Sign an x402 payment using EIP-712 TransferWithAuthorization (EIP-3009).
//
// Sign and output the PAYMENT-SIGNATURE header value:
//   node scripts/sign-x402-payment.mjs sign --requirements '<base64>' [--key <hex>]
//
// Print the EIP-712 payload for use with another signing system:
//   node scripts/sign-x402-payment.mjs payload --requirements '<base64>'
//
// Requires: npm install viem

import { randomBytes } from 'crypto';

const args = process.argv.slice(2);
const cmd  = args[0];

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

if (cmd !== 'sign' && cmd !== 'payload') {
  console.error('Usage:');
  console.error('  node scripts/sign-x402-payment.mjs sign --requirements <base64> [--key <hex>]');
  console.error('  node scripts/sign-x402-payment.mjs payload --requirements <base64>');
  process.exit(1);
}

const requirementsB64 = getFlag('--requirements');
const keyArg = getFlag('--key') || process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ETH_PRIVATE_KEY;

if (!requirementsB64) {
  console.error('Usage:');
  console.error('  node scripts/sign-x402-payment.mjs sign --requirements <base64> [--key <hex>]');
  console.error('  node scripts/sign-x402-payment.mjs payload --requirements <base64>');
  process.exit(1);
}

// Decode the PAYMENT-REQUIRED header
let requirements;
try {
  requirements = JSON.parse(Buffer.from(requirementsB64, 'base64').toString('utf8'));
} catch {
  console.error('Failed to decode --requirements: must be base64-encoded JSON from a PAYMENT-REQUIRED header.');
  process.exit(1);
}

// x402 v1 uses short network names; v0 used eip155:<chainId>
const CHAIN_IDS = { 'base': 8453, 'base-sepolia': 84532 };
function evmChainId(network) {
  if (network?.startsWith('eip155:')) return parseInt(network.split(':')[1], 10);
  return CHAIN_IDS[network] ?? null;
}

// Find first EVM accepts entry
const accepted = (requirements.accepts || []).find(a => evmChainId(a.network) !== null);
if (!accepted) {
  console.error('No EVM payment method in requirements. Only base and base-sepolia are supported by this script.');
  process.exit(1);
}

const chainId      = evmChainId(accepted.network);
const tokenName    = accepted.extra?.name    || accepted.extra?.tokenName    || 'USD Coin';
const tokenVersion = accepted.extra?.version || accepted.extra?.tokenVersion || '2';
const tokenAddress = accepted.asset;
const payTo        = accepted.payTo;
const amount       = accepted.maxAmountRequired || accepted.amount;
const maxTimeout   = accepted.maxTimeoutSeconds || 60;

const domain = {
  name: tokenName,
  version: tokenVersion,
  chainId,
  verifyingContract: tokenAddress,
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

const now         = Math.floor(Date.now() / 1000);
const validAfter  = BigInt(now - 5);
const validBefore = BigInt(now + maxTimeout);
const nonce       = '0x' + randomBytes(32).toString('hex');

const makeMessage = (from) => ({
  from,
  to: payTo,
  value: BigInt(amount),
  validAfter,
  validBefore,
  nonce,
});

// ── payload: print EIP-712 JSON for use with another signing system ────────────

if (cmd === 'payload') {
  console.log(JSON.stringify(
    { domain, types, primaryType: 'TransferWithAuthorization', message: makeMessage('<YOUR_WALLET_ADDRESS>') },
    (_, v) => typeof v === 'bigint' ? v.toString() : v,
    2
  ));
  process.exit(0);
}

// ── sign: sign and output PAYMENT-SIGNATURE ────────────────────────────────────

if (!keyArg) {
  console.error(
    'No private key found. Set PRIVATE_KEY env var, pass --key <hex>, or use the payload command to get the EIP-712 JSON for manual signing.'
  );
  process.exit(1);
}

try {
  const { privateKeyToAccount } = await import('viem/accounts');

  const hexKey  = keyArg.startsWith('0x') ? keyArg : `0x${keyArg}`;
  const account = privateKeyToAccount(hexKey);
  const message = makeMessage(account.address);

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const payment = {
    x402Version: requirements.x402Version || 1,
    scheme:  accepted.scheme,
    network: accepted.network,
    payload: {
      signature,
      authorization: {
        from:        account.address,
        to:          payTo,
        value:       amount,
        validAfter:  validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  console.log(Buffer.from(JSON.stringify(payment)).toString('base64'));
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find package')) {
    console.error('viem is required: npm install viem');
    console.error('Or use the payload command to get the EIP-712 JSON for signing with another tool.');
  } else {
    console.error('Signing failed:', e.message);
  }
  process.exit(1);
}
