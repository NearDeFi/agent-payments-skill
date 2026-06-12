// Unit tests for scripts/x402-options.mjs — the shared option-verification helpers
// that the --max-price guard in pay.mjs and check-price.mjs is built on.
//
// Tests:
//   1. evmChainId maps the short name and CAIP-2 form of Base mainnet
//   2. evmChainId returns null for unrecognized and malformed networks (never NaN)
//   3. parseUsdcToAtomic parses valid USDC amounts and rejects invalid formats
//   4. isVerifiableBaseUsdcOption accepts only exact-scheme Base mainnet USDC with an integer amount
//   5. baseUsdcOptions filters to verifiable options and sorts cheapest-first with BigInt precision

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_MAINNET_CHAIN_ID, BASE_USDC_ADDRESS,
  evmChainId, parseUsdcToAtomic, isVerifiableBaseUsdcOption, baseUsdcOptions,
} from '../x402-pay/scripts/x402-options.mjs';

const usdcOption = (overrides = {}) => ({
  scheme: 'exact',
  network: 'base',
  maxAmountRequired: '10000',
  asset: BASE_USDC_ADDRESS,
  ...overrides,
});

test('evmChainId: maps Base short name and CAIP-2 form', () => {
  assert.equal(evmChainId('base'), BASE_MAINNET_CHAIN_ID);
  assert.equal(evmChainId('eip155:8453'), BASE_MAINNET_CHAIN_ID);
  assert.equal(evmChainId('eip155:1'), 1);
});

test('evmChainId: returns null for unrecognized and malformed networks', () => {
  assert.equal(evmChainId('polygon'), null);
  assert.equal(evmChainId('eip155:'), null);
  assert.equal(evmChainId('eip155:not-a-number'), null);
  // parseInt would have accepted this trailing-garbage form as 8453
  assert.equal(evmChainId('eip155:8453garbage'), null);
  assert.equal(evmChainId(''), null);
  assert.equal(evmChainId(null), null);
  assert.equal(evmChainId(undefined), null);
  assert.equal(evmChainId(8453), null);
});

test('parseUsdcToAtomic: parses valid amounts, rejects invalid formats', () => {
  assert.equal(parseUsdcToAtomic('0.01'), 10000n);
  assert.equal(parseUsdcToAtomic('1'), 1000000n);
  assert.equal(parseUsdcToAtomic('0.000001'), 1n);
  assert.equal(parseUsdcToAtomic('abc'), null);
  assert.equal(parseUsdcToAtomic('0.0000001'), null); // 7 decimals
  assert.equal(parseUsdcToAtomic('-1'), null);
  assert.equal(parseUsdcToAtomic('1e6'), null);
  assert.equal(parseUsdcToAtomic(''), null);
});

test('isVerifiableBaseUsdcOption: accepts only exact Base mainnet USDC with integer amount', () => {
  assert.equal(isVerifiableBaseUsdcOption(usdcOption()), true);
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ network: 'eip155:8453', maxAmountRequired: undefined, amount: '10000' })), true);
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ asset: BASE_USDC_ADDRESS.toUpperCase().replace('0X', '0x') })), true, 'asset match is case-insensitive');
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ scheme: 'upto' })), false);
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ network: 'eip155:1' })), false);
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ asset: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb' })), false, 'non-USDC asset');
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ asset: undefined })), false);
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ maxAmountRequired: '1.5' })), false, 'non-integer amount');
  assert.equal(isVerifiableBaseUsdcOption(usdcOption({ maxAmountRequired: undefined })), false, 'missing amount');
  assert.equal(isVerifiableBaseUsdcOption(null), false);
});

test('baseUsdcOptions: filters and sorts cheapest-first with BigInt precision', () => {
  const cheap   = usdcOption({ maxAmountRequired: '9007199254740992' });  // 2^53
  const dear    = usdcOption({ maxAmountRequired: '9007199254740993' });  // 2^53 + 1 — equal under Number
  const foreign = usdcOption({ network: 'eip155:1' });
  assert.deepEqual(baseUsdcOptions([dear, foreign, cheap]), [cheap, dear]);
  assert.deepEqual(baseUsdcOptions('not-an-array'), []);
  assert.deepEqual(baseUsdcOptions(undefined), []);
});
