#!/usr/bin/env node
// NEAR Intents 1-click API: list supported tokens, get swap quotes, check swap status.
//
// List tokens (find the right --from value for quote):
//   node scripts/near-intents.mjs tokens [--chain <chain>]
//
// Get a committed quote (deposit address + exact send amount):
//   node scripts/near-intents.mjs quote --usdc <amount> --from <chain:SYMBOL> --wallet <baseAddress> --refund <sendingAddress> [--override-cost-cap]
//   Rejects quotes whose USD overhead exceeds both 2.5% and $0.005; --override-cost-cap proceeds anyway (user-approved).
//   A failed/partial swap always refunds the origin asset on the origin chain to --refund.
//
// Check swap status:
//   node scripts/near-intents.mjs status <depositAddress> [--memo <memo>]

import https from 'https';
import { assessOverhead, MAX_OVERHEAD_USD, MAX_OVERHEAD_PCT } from './cost-guard.mjs';
import { makeGetArg } from './cli-args.mjs';

const API        = 'https://1click.chaindefuser.com';
const DEST_ASSET = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';

// How long we ask 1Click to hold the deposit open. This is the point at which a refund
// begins if the swap hasn't completed, so it must exceed the time for the deposit to be
// *mined* on the origin chain — the API docs cite ~1 hour for Bitcoin. A longer window
// costs nothing (quoted amounts are identical at 10 minutes and 24 hours).
const DEPOSIT_WINDOW_MINUTES = 120;

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

  // Error bodies carry no `status` field (an unknown deposit address 404s), so without this
  // the monitor loop would print `Status: undefined` and poll forever. Most 4xx are
  // permanent — print FATAL so the loop breaks. 408/429 are retryable, as is anything else
  // (5xx): print RETRYING and stay pollable so a blip can't abandon an in-flight swap.
  const RETRYABLE_4XX = [408, 429];
  if (!result.status) {
    const fatal = result.statusCode >= 400 && result.statusCode < 500 && !RETRYABLE_4XX.includes(result.statusCode);
    console.log(`${fatal ? 'FATAL' : 'RETRYING'}: ${result.message || 'unexpected response from the status API'}`);
    process.exit(fatal ? 1 : 0);
  }

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

  // --refund-type was removed: refunds are always returned on the origin chain. Reject it
  // rather than ignore it, so a caller asking for an intents refund can't silently get an
  // origin-chain refund to an address that only exists on Base. Match the inline
  // `--refund-type=intents` form too — unknown args are otherwise ignored, so checking only
  // the two-token form would leave exactly that silent fallback in place.
  if (args.some(a => a === '--refund-type' || a.startsWith('--refund-type='))) {
    console.error('--refund-type is no longer supported — refunds are always returned on the origin chain.');
    console.error('Pass --refund <address on the origin chain you send from> and drop --refund-type.');
    process.exit(1);
  }

  if (!usdcArg || !fromArg || !refundArg) {
    console.error('Usage:');
    console.error('  node scripts/near-intents.mjs quote --usdc <amount> --from <chain:SYMBOL> --wallet <address> --refund <address>');
    console.error('  --refund is required — the origin-chain address a failed swap is returned to');
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
  const deadline = new Date(Date.now() + DEPOSIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const refundTo = refundArg;

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
    refundType:       'ORIGIN_CHAIN',
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
    console.error('bypassable with --override-cost-cap. Tell the user the funding source they picked could');
    console.error('not produce a usable quote, ask where else they hold assets, and go back to "Determine');
    console.error('source of funds" to start again from their new choice.');
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

  // ── Deadline guard ────────────────────────────────────────────────────────
  // Two clocks come back with different consequences: the deadline we requested (after
  // which a refund begins if the swap hasn't completed) and `q.deadline` (after which the
  // deposit address goes inactive and funds may be LOST). Refunding assumes the address is
  // still live, so the request deadline must land first. If the response ever inverts that
  // — or omits its deadline — the safe consequence can't be promised, so withhold the quote
  // rather than print a deposit address under the wrong explanation.
  const requestedMs      = Date.parse(deadline);
  const addressExpiresMs = Date.parse(q.deadline);
  if (!Number.isFinite(addressExpiresMs) || addressExpiresMs < requestedMs) {
    console.error('DEADLINE MISMATCH — funding quote withheld (no deposit address shown).');
    console.error(`  Deposit window requested: ${deadline} (${DEPOSIT_WINDOW_MINUTES} minutes)`);
    console.error(`  Deposit address expires:  ${q.deadline ?? '(absent from the quote response)'}`);
    console.error('The address would go inactive before the deposit deadline, so a late deposit could be');
    console.error('LOST instead of refunded. This is NOT overridable. Tell the user the funding source they');
    console.error('picked could not produce a usable quote, ask where else they hold assets, and go back to');
    console.error('"Determine source of funds" to start again from their new choice.');
    process.exit(1);
  }

  console.log(`Send:    ${q.amountInFormatted} ${fromSymbol} on ${fromChain}`);
  console.log(`Receive: ${q.amountOutFormatted} USDC on Base`);
  console.log(`Send (units): ${q.amountIn}`);
  console.log(`\nDeposit to: ${q.depositAddress}`);
  if (token.contractAddress) console.log(`Asset:      ${token.contractAddress}`);
  // Always the deadline we submitted — the one whose consequence (refund) is described here.
  const minutesLeft = Math.max(0, Math.floor((requestedMs - Date.now()) / 60_000));
  console.log(`Deposit by: ${deadline} (~${minutesLeft} minutes from now) — the swap must COMPLETE by then: the deposit has to be confirmed on ${fromChain}, plus ~${q.timeEstimate}s to execute. Miss it and the deposit is refunded to the refund address instead of swapped, so send promptly rather than near the deadline. After that, run a fresh quote.`);

  // Refund destination — confirm this with the user BEFORE they send to the deposit address.
  console.log(`Refund to:  ${refundTo} on ${fromChain} — origin chain (returned on-chain if the swap fails)`);

  if (q.depositMemo) {
    console.log(`\nMEMO REQUIRED: ${q.depositMemo}`);
    console.log('You MUST include this as the transaction memo — funds are permanently lost if omitted.');
  }

} else {
  console.error(`Unknown command: ${cmd ?? '(none)'}`);
  console.error('Usage:');
  console.error('  node scripts/near-intents.mjs tokens [--chain <chain>]');
  console.error('  node scripts/near-intents.mjs quote --usdc <amount> --from <chain:SYMBOL> --wallet <address> --refund <address>');
  console.error('  node scripts/near-intents.mjs status <depositAddress> [--memo <memo>]');
  process.exit(1);
}
