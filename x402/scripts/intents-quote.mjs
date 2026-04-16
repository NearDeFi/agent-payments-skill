#!/usr/bin/env node
// NEAR Intents cross-chain swap: get a quote or check swap status.
//
// Dry quote (preview, no funds committed):
//   node scripts/intents-quote.mjs quote --dry --usdc 1.00 --from eth:ETH [--refund 0xAddr] [--wallet 0xBase]
//
// Committed quote (get deposit address):
//   node scripts/intents-quote.mjs quote --usdc 1.00 --from eth:ETH [--refund 0xAddr] [--wallet 0xBase]
//
// Check swap status:
//   node scripts/intents-quote.mjs status <depositAddress> [--memo <memo>]

import https from 'https';

const API        = 'https://1click.chaindefuser.com';
const DEST_ASSET = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';

const args = process.argv.slice(2);
const cmd  = args[0];

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const url = new URL(API + path);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON response: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Status ────────────────────────────────────────────────────────────────────

if (cmd === 'status') {
  const depositAddress = args[1];
  if (!depositAddress) {
    console.error('Usage: node scripts/intents-quote.mjs status <depositAddress> [--memo <memo>]');
    process.exit(1);
  }

  const memoArg = getArg('--memo');
  const qs = memoArg
    ? `?depositAddress=${depositAddress}&depositMemo=${memoArg}`
    : `?depositAddress=${depositAddress}`;
  const result = await apiRequest('GET', `/v0/status${qs}`);

  const labels = {
    PENDING_DEPOSIT:    'Waiting for deposit to be detected',
    KNOWN_DEPOSIT_TX:   'Deposit detected, awaiting confirmation',
    INCOMPLETE_DEPOSIT: 'Amount sent was less than required — may need a top-up',
    PROCESSING:         'Swap is executing',
    SUCCESS:            'Swap complete — USDC should be on Base',
    REFUNDED:           'Swap failed, assets returned to refund address',
    FAILED:             'Swap failed, assets not returned — check details below',
  };

  console.log(`Status: ${result.status}${labels[result.status] ? ` — ${labels[result.status]}` : ''}`);
  if (result.swapDetails) console.log('Details:', JSON.stringify(result.swapDetails, null, 2));
  process.exit(0);
}

// ── Quote ─────────────────────────────────────────────────────────────────────

if (cmd === 'quote') {
  const usdcArg   = getArg('--usdc');
  const fromArg   = getArg('--from');
  const refundArg = getArg('--refund');
  const walletArg = getArg('--wallet');
  const isDry     = args.includes('--dry');

  if (!usdcArg || !fromArg) {
    console.error('Usage:');
    console.error('  node scripts/intents-quote.mjs quote [--dry] --usdc <amount> --from <chain:SYMBOL> [--refund <address>] [--wallet <address>]');
    process.exit(1);
  }

  const parts = fromArg.split(':');
  if (parts.length !== 2) {
    console.error('--from must be chain:SYMBOL, e.g. eth:ETH or sol:SOL or base:USDC');
    process.exit(1);
  }
  const [fromChain, fromSymbol] = parts;

  // Derive wallet address from private key if not provided
  let walletAddress = walletArg;
  if (!walletAddress) {
    const key = process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ETH_PRIVATE_KEY;
    if (key) {
      const { privateKeyToAccount } = await import('viem/accounts');
      walletAddress = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`).address;
    }
  }
  if (!walletAddress) {
    console.error('No wallet address. Pass --wallet <Base address> or set PRIVATE_KEY env var.');
    process.exit(1);
  }

  // Look up origin asset ID from tokens endpoint
  const tokens = await apiRequest('GET', '/v0/tokens');
  const token = tokens.find(t =>
    t.blockchain?.toLowerCase() === fromChain.toLowerCase() &&
    t.symbol?.toUpperCase() === fromSymbol.toUpperCase()
  );
  if (!token) {
    console.error(`Token not found: ${fromSymbol} on ${fromChain}`);
    console.error('Supported tokens: https://1click.chaindefuser.com/v0/tokens');
    process.exit(1);
  }

  const amount   = Math.round(parseFloat(usdcArg) * 1_000_000).toString();
  const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const refundType = refundArg ? 'ORIGIN_CHAIN' : 'INTENTS';
  const refundTo   = refundArg ?? walletAddress;

  if (!refundArg) {
    console.warn('Note: no --refund address provided. If the swap fails, funds will land in the NEAR Intents');
    console.warn('internal balance for your Base wallet address and must be manually withdrawn to recover them.\n');
  }

  const quoteBody = {
    dry:              isDry,
    swapType:         'EXACT_OUTPUT',
    originAsset:      token.assetId,
    destinationAsset: DEST_ASSET,
    amount,
    recipient:        walletAddress,
    refundTo,
    depositType:      'ORIGIN_CHAIN',
    recipientType:    'DESTINATION_CHAIN',
    refundType,
    deadline,
    slippageTolerance: 100,
  };

  const response = await apiRequest('POST', '/v0/quote', quoteBody);

  if (response.error || response.message) {
    console.error('Quote failed:', response.error || response.message);
    process.exit(1);
  }

  const q = response.quote;

  console.log(`Send:    ${q.amountInFormatted} ${fromSymbol} on ${fromChain}`);
  console.log(`Receive: ${q.amountOutFormatted} USDC on Base`);

  if (isDry) {
    console.log('\n(Dry quote — confirm with user before proceeding)');
  } else {
    console.log(`\nDeposit to: ${q.depositAddress}`);
    if (token.contractAddress) console.log(`Asset:      ${token.contractAddress}`);
    console.log(`By:         ${q.deadline}`);

    if (q.depositMemo) {
      console.log(`\nMEMO REQUIRED: ${q.depositMemo}`);
      console.log('You MUST include this as the transaction memo — funds are permanently lost if omitted.');
    }
  }

} else {
  console.error(`Unknown command: ${cmd ?? '(none)'}`);
  console.error('Usage:');
  console.error('  node scripts/intents-quote.mjs quote [--dry] --usdc <amount> --from <chain:SYMBOL>');
  console.error('  node scripts/intents-quote.mjs status <depositAddress> [--memo <memo>]');
  process.exit(1);
}
