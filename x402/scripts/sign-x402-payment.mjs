#!/usr/bin/env node
// Sign an x402 payment using EIP-712 TransferWithAuthorization (EIP-3009).
// Outputs the base64-encoded PAYMENT-SIGNATURE header value.
//
// Usage:
//   node scripts/sign-x402-payment.mjs --requirements '<base64 PAYMENT-REQUIRED header>' --key $PRIVATE_KEY
//   node scripts/sign-x402-payment.mjs --print-payload --requirements '<base64>' [--key $PRIVATE_KEY]
//
// Requires: npm install viem
// For other signing systems, use --print-payload to get the EIP-712 JSON.

import { randomBytes } from 'crypto';

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const printPayload = args.includes('--print-payload');
const requirementsB64 = getFlag('--requirements');
const keyArg = getFlag('--key') || process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ETH_PRIVATE_KEY;

if (!requirementsB64) {
  console.error('Usage: node sign-x402-payment.mjs --requirements <base64> [--key <hex>] [--print-payload]');
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

// Find first EVM (eip155:*) accepts entry
const accepted = (requirements.accepts || []).find(a => a.network?.startsWith('eip155:'));
if (!accepted) {
  console.error('No EVM payment method in requirements. Only eip155:* networks are supported by this script.');
  process.exit(1);
}

const chainId = parseInt(accepted.network.split(':')[1], 10);
const tokenName = accepted.extra?.tokenName || 'USD Coin';
const tokenVersion = accepted.extra?.tokenVersion || '2';
const tokenAddress = accepted.asset;
const payTo = accepted.payTo;
const amount = accepted.amount;
const maxTimeout = accepted.maxTimeoutSeconds || 60;

// EIP-712 domain and types for TransferWithAuthorization (EIP-3009)
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

const now = Math.floor(Date.now() / 1000);
const validAfter  = BigInt(now - 5);
const validBefore = BigInt(now + maxTimeout);
const nonce = '0x' + randomBytes(32).toString('hex');

const makeMessage = (from) => ({
  from,
  to: payTo,
  value: BigInt(amount),
  validAfter,
  validBefore,
  nonce,
});

// --print-payload without a key: just print the EIP-712 JSON for use with another signing system
if (printPayload && !keyArg) {
  console.log(JSON.stringify(
    { domain, types, primaryType: 'TransferWithAuthorization', message: makeMessage('<YOUR_WALLET_ADDRESS>') },
    (_, v) => typeof v === 'bigint' ? v.toString() : v,
    2
  ));
  process.exit(0);
}

if (!keyArg) {
  console.error(
    'No private key found. Set PRIVATE_KEY env var, pass --key <hex>, or use --print-payload to get the EIP-712 JSON for manual signing.'
  );
  process.exit(1);
}

// Sign using viem
try {
  const { privateKeyToAccount } = await import('viem/accounts');

  const hexKey = keyArg.startsWith('0x') ? keyArg : `0x${keyArg}`;
  const account = privateKeyToAccount(hexKey);
  const message = makeMessage(account.address);

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  if (printPayload) {
    process.stderr.write('EIP-712 payload:\n');
    process.stderr.write(JSON.stringify(
      { domain, types, primaryType: 'TransferWithAuthorization', message },
      (_, v) => typeof v === 'bigint' ? v.toString() : v,
      2
    ) + '\n');
    process.stderr.write(`Signing address: ${account.address}\n\n`);
  }

  // Build the PAYMENT-SIGNATURE header JSON
  const payment = {
    x402Version: requirements.x402Version || 1,
    scheme: accepted.scheme,
    network: accepted.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: payTo,
        value: amount,
        validAfter:  validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  // Print only the base64 header value to stdout (ready to use)
  console.log(Buffer.from(JSON.stringify(payment)).toString('base64'));
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find package')) {
    console.error('viem is required: npm install viem');
    console.error('Or use --print-payload (without --key) to get the EIP-712 JSON for signing with another tool.');
  } else {
    console.error('Signing failed:', e.message);
  }
  process.exit(1);
}
