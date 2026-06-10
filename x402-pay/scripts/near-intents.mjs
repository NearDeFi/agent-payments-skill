#!/usr/bin/env node
// NEAR Intents 1-click API: list supported tokens, get swap quotes, check swap status.
//
// List tokens (find the right --from value for quote):
//   node scripts/near-intents.mjs tokens [--chain <chain>]
//
// Get a committed quote (deposit address + exact send amount):
//   node scripts/near-intents.mjs quote --usdc <amount> --from <chain:SYMBOL> --wallet <baseAddress> [--refund <sendingAddress>] [--refund-type origin|intents] [--override-cost-cap]
//   Rejects quotes whose USD overhead exceeds both 2.5% and $0.005; --override-cost-cap proceeds anyway (user-approved).
//   --refund-type origin (default): refund to --refund on the origin chain. intents: refund to a NEAR Intents
//   balance keyed to --refund (defaults to --wallet) — claimable by connecting that wallet at app.near-intents.org.
//
// Check swap status:
//   node scripts/near-intents.mjs status <depositAddress> [--memo <memo>]

import https from 'https';
import { assessOverhead, MAX_OVERHEAD_USD, MAX_OVERHEAD_PCT } from './cost-guard.mjs';
import { makeGetArg } from './cli-args.mjs';

const API        = 'https://1click.chaindefuser.com';
const DEST_ASSET = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';

const args = process.argv.slice(2);
const cmd  = args[0];

const getArg = makeGetArg(args);

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

// ── Tokens ────────────────────────────────────────────────────────────────────

if (cmd === 'tokens') {
  const chainFilter = getArg('--chain');

  const tokens = await apiRequest('GET', '/v0/tokens');

  let filtered = tokens;
  if (chainFilter) {
    filtered = tokens.filter(t => t.blockchain?.toLowerCase() === chainFilter.toLowerCase());
    if (filtered.length === 0) {
      console.error(`No tokens found for chain: ${chainFilter}`);
      console.error('Available chains: ' + [...new Set(tokens.map(t => t.blockchain?.toLowerCase()))].sort().join(', '));
      process.exit(1);
    }
  }

  console.log('Use <chain>:<SYMBOL> as the --from argument to the quote command:\n');
  for (const t of filtered) {
    const fromArg = `${t.blockchain?.toLowerCase()}:${t.symbol?.toUpperCase()}`;
    const price   = t.price ? ` ($${parseFloat(t.price).toFixed(4)})` : '';
    console.log(`  ${fromArg.padEnd(20)} ${t.symbol}${price}`);
  }

// ── Status ────────────────────────────────────────────────────────────────────

} else if (cmd === 'status') {
  const depositAddress = args[1];
  if (!depositAddress) {
    console.error('Usage: node scripts/near-intents.mjs status <depositAddress> [--memo <memo>]');
    process.exit(1);
  }

  const memoArg = getArg('--memo');
  const params = new URLSearchParams({ depositAddress });
  if (memoArg) params.set('depositMemo', memoArg);
  const result = await apiRequest('GET', `/v0/status?${params}`);

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

// ── Quote ─────────────────────────────────────────────────────────────────────

} else if (cmd === 'quote') {
  const usdcArg   = getArg('--usdc');
  const fromArg   = getArg('--from');
  const refundArg = getArg('--refund');
  const walletArg = getArg('--wallet');
  const refundTypeArg = (getArg('--refund-type') || 'origin').toLowerCase();

  if (refundTypeArg !== 'origin' && refundTypeArg !== 'intents') {
    console.error('--refund-type must be "origin" or "intents"');
    process.exit(1);
  }
  const refundToIntents = refundTypeArg === 'intents';

  // --refund is required for an origin-chain refund; for intents it defaults to --wallet.
  if (!usdcArg || !fromArg || (!refundArg && !refundToIntents)) {
    console.error('Usage:');
    console.error('  node scripts/near-intents.mjs quote --usdc <amount> --from <chain:SYMBOL> --wallet <address> [--refund <address>] [--refund-type origin|intents]');
    console.error('  --refund is required unless --refund-type intents (then it defaults to --wallet)');
    console.error('  Use "tokens" subcommand to list valid --from values');
    process.exit(1);
  }

  const parts = fromArg.split(':');
  if (parts.length !== 2) {
    console.error('--from must be chain:SYMBOL, e.g. eth:ETH or sol:SOL or near:USDC');
    console.error('Run: node scripts/near-intents.mjs tokens  to list all valid values');
    process.exit(1);
  }
  const [fromChain, fromSymbol] = parts;

  if (!walletArg) {
    console.error('--wallet <address> is required — your Base wallet address');
    process.exit(1);
  }
  const walletAddress = walletArg;

  // Look up origin asset ID from tokens endpoint
  const tokens = await apiRequest('GET', '/v0/tokens');
  const token = tokens.find(t =>
    t.blockchain?.toLowerCase() === fromChain.toLowerCase() &&
    t.symbol?.toUpperCase() === fromSymbol.toUpperCase()
  );
  if (!token) {
    console.error(`Token not found: ${fromSymbol} on ${fromChain}`);
    console.error('Run: node scripts/near-intents.mjs tokens to list all valid chain:SYMBOL pairs');
    process.exit(1);
  }

  const amount   = Math.round(parseFloat(usdcArg) * 1_000_000).toString();
  const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const refundType = refundToIntents ? 'INTENTS' : 'ORIGIN_CHAIN';
  let   refundTo   = refundArg || walletAddress;  // intents mode defaults the refund to the Base wallet
  // A NEAR Intents account id for an EVM address must be lowercase — the API rejects the
  // checksummed (mixed-case) form. Only normalise EVM-shaped addresses; leave other ids as-is.
  if (refundToIntents && /^0x[0-9a-fA-F]{40}$/.test(refundTo)) refundTo = refundTo.toLowerCase();

  const quoteBody = {
    dry:              false,
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

  // ── Cost guard ────────────────────────────────────────────────────────────
  // Reject quotes whose USD overhead exceeds BOTH the % and $ caps (see cost-guard.mjs).
  // Override only with explicit user consent via --override-cost-cap.
  // assessOverhead throws when the quote lacks usable USD figures — fail closed:
  // print a clear message and exit 1 rather than crash with a raw stack trace.
  let cost;
  try {
    cost = assessOverhead(q.amountInUsd, q.amountOutUsd);
  } catch (e) {
    console.error(`COST LIMIT EXCEEDED (unverifiable quote) — ${e.message}`);
    console.error('The funding cost could not be measured, so the deposit address is withheld. This is NOT');
    console.error('bypassable with --override-cost-cap. Report to the user and fund from a different source');
    console.error('asset (run the "tokens" command for options).');
    process.exit(1);
  }
  const override = args.includes('--override-cost-cap');

  if (cost.exceeds && !override) {
    console.error('COST LIMIT EXCEEDED — funding quote withheld (no deposit address shown).');
    console.error(`  Send:     $${Number(q.amountInUsd).toFixed(4)} of ${fromSymbol} on ${fromChain}`);
    console.error(`  Receive:  $${Number(q.amountOutUsd).toFixed(4)} USDC on Base`);
    console.error(`  Overhead: $${cost.overheadUsd.toFixed(4)} (${cost.overheadPct.toFixed(2)}%) — over the ${MAX_OVERHEAD_PCT}% AND $${MAX_OVERHEAD_USD} limit.`);
    console.error('');
    console.error('Do NOT proceed silently. Report the above to the user and ask whether to:');
    console.error('  1. Fund from a different, more liquid source asset — re-run quote with a different');
    console.error('     --from (run the "tokens" command to list options), OR');
    console.error('  2. Continue anyway at this cost — ONLY if the user explicitly agrees, re-run this');
    console.error('     exact command with --override-cost-cap appended.');
    process.exit(1);
  } else if (cost.exceeds && override) {
    console.warn(`WARNING: overhead $${cost.overheadUsd.toFixed(4)} (${cost.overheadPct.toFixed(2)}%) exceeds the ${MAX_OVERHEAD_PCT}% / $${MAX_OVERHEAD_USD} limit — proceeding (user-approved via --override-cost-cap).\n`);
  }

  console.log(`Send:    ${q.amountInFormatted} ${fromSymbol} on ${fromChain}`);
  console.log(`Receive: ${q.amountOutFormatted} USDC on Base`);
  console.log(`Send (units): ${q.amountIn}`);
  console.log(`\nDeposit to: ${q.depositAddress}`);
  if (token.contractAddress) console.log(`Asset:      ${token.contractAddress}`);
  const minutesLeft = Math.max(0, Math.floor((new Date(q.deadline) - Date.now()) / 60_000));
  console.log(`Valid until: ${q.deadline} (~${minutesLeft} minutes from now) — the deposit must arrive by then; after that the quote expires and you must run a fresh quote.`);

  // Refund destination — confirm this with the user BEFORE they send to the deposit address.
  if (refundToIntents) {
    console.log(`Refund to:  ${refundTo} — NEAR Intents balance (if the swap fails, claim it by connecting this wallet at app.near-intents.org)`);
  } else {
    console.log(`Refund to:  ${refundTo} on ${fromChain} — origin chain (returned on-chain if the swap fails)`);
  }

  if (q.depositMemo) {
    console.log(`\nMEMO REQUIRED: ${q.depositMemo}`);
    console.log('You MUST include this as the transaction memo — funds are permanently lost if omitted.');
  }

} else {
  console.error(`Unknown command: ${cmd ?? '(none)'}`);
  console.error('Usage:');
  console.error('  node scripts/near-intents.mjs tokens [--chain <chain>]');
  console.error('  node scripts/near-intents.mjs quote --usdc <amount> --from <chain:SYMBOL> --wallet <address> [--refund <address>] [--refund-type origin|intents]');
  console.error('  node scripts/near-intents.mjs status <depositAddress> [--memo <memo>]');
  process.exit(1);
}
