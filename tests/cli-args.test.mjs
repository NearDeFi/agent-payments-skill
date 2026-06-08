// Unit tests for the shared CLI arg parser (x402-pay/scripts/cli-args.mjs).
// Pure logic — deterministic, no network.
//
// Tests:
//   1. returns the value following a flag
//   2. returns null when the flag is absent
//   3. returns null when the flag is last (no value)
//   4. returns null when the next token is another flag (the bug this guards)
//   5. parses flags correctly regardless of position
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGetArg } from '../x402-pay/scripts/cli-args.mjs';

test('cli-args: returns the value following a flag', () => {
  const getArg = makeGetArg(['--from', 'eth:ETH', '--usdc', '1.00']);
  assert.equal(getArg('--from'), 'eth:ETH');
  assert.equal(getArg('--usdc'), '1.00');
});

test('cli-args: returns null when the flag is absent', () => {
  const getArg = makeGetArg(['--from', 'eth:ETH']);
  assert.equal(getArg('--wallet'), null);
});

test('cli-args: returns null when the flag is last (no value)', () => {
  const getArg = makeGetArg(['--usdc', '1', '--refund']);
  assert.equal(getArg('--refund'), null);
});

test('cli-args: returns null when the next token is another flag', () => {
  const getArg = makeGetArg(['--refund', '--wallet', '0xabc']);
  assert.equal(getArg('--refund'), null);
  assert.equal(getArg('--wallet'), '0xabc');
});

test('cli-args: parses flags correctly regardless of position', () => {
  const getArg = makeGetArg(['quote', '--usdc', '5', '--from', 'sol:SOL', '--wallet', '0x1', '--refund', '0x2']);
  assert.equal(getArg('--wallet'), '0x1');
  assert.equal(getArg('--refund'), '0x2');
  assert.equal(getArg('--from'), 'sol:SOL');
});
