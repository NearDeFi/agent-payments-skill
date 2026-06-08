// Unit tests for the funding cost guard (x402-pay/scripts/cost-guard.mjs).
// Pure logic — deterministic, no network or wallet needed.
// The rule: reject only when overhead exceeds BOTH the $ floor AND the % cap.
//
// Tests:
//   1. thresholds are 2.5% and $0.005
//   2. rejects when overhead is over BOTH caps
//   3. large $ overhead passes when the % is under the cap
//   4. dust passes via the $ floor despite a huge %
//   5. exactly at the % cap does not exceed (strict >)
//   6. accepts string USD figures (as the quote API returns them)
//   7. throws on missing/invalid/zero-output figures (fail closed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessOverhead, MAX_OVERHEAD_USD, MAX_OVERHEAD_PCT } from '../x402-pay/scripts/cost-guard.mjs';

test('cost-guard: thresholds are 2.5% and $0.005', () => {
  assert.equal(MAX_OVERHEAD_PCT, 2.5);
  assert.equal(MAX_OVERHEAD_USD, 0.005);
});

test('cost-guard: rejects when over BOTH caps', () => {
  const r = assessOverhead(0.2052, 0.1999); // ~2.65%, ~$0.0053
  assert.equal(r.exceeds, true);
  assert.ok(r.overheadPct > MAX_OVERHEAD_PCT && r.overheadUsd > MAX_OVERHEAD_USD);
});

test('cost-guard: large $ overhead passes when % is under the cap', () => {
  const r = assessOverhead(1011, 1000); // 1.1%, $11
  assert.ok(r.overheadUsd > MAX_OVERHEAD_USD);
  assert.ok(r.overheadPct < MAX_OVERHEAD_PCT);
  assert.equal(r.exceeds, false);
});

test('cost-guard: dust passes via the $ floor despite a huge %', () => {
  const r = assessOverhead(0.0125, 0.01); // 25% but only $0.0025
  assert.ok(r.overheadPct > MAX_OVERHEAD_PCT);
  assert.ok(r.overheadUsd < MAX_OVERHEAD_USD);
  assert.equal(r.exceeds, false);
});

test('cost-guard: exactly at the % cap does not exceed (strict >)', () => {
  const r = assessOverhead(102.5, 100); // overhead $2.5, exactly 2.5%
  assert.equal(r.overheadPct, 2.5);
  assert.equal(r.exceeds, false);
});

test('cost-guard: accepts string USD figures (as the quote API returns them)', () => {
  const r = assessOverhead('0.2052', '0.1999');
  assert.equal(r.exceeds, true);
});

test('cost-guard: throws on missing/invalid/zero-output figures (fail closed)', () => {
  for (const [a, b] of [[undefined, 1], [1, undefined], ['nope', 1], [1, 0], [1, -1], [NaN, 1]]) {
    assert.throws(() => assessOverhead(a, b), /Cannot verify funding cost/, `expected throw for (${a}, ${b})`);
  }
});
