// Tests the polling loop documented in references/near-intents-funding.md (Step 4).
// The doc snippet is the source of truth — these tests stub the inner status command
// and run the loop verbatim (the only deviation is `sleep 0` instead of `sleep 5`).
//
// The contract is:
//   1. The loop exits 0 (so wrappers that retry-via-exit-1 don't pollute tooling logs).
//   2. Non-terminal statuses (PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING) are iterated past.
//   3. Each terminal status (SUCCESS, REFUNDED, FAILED, INCOMPLETE_DEPOSIT) breaks the loop.
//   4. A FATAL line (permanent API failure, e.g. an unknown deposit address) breaks the loop,
//      while a RETRYING line (transient failure) is iterated past like a non-terminal status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const execAsync = promisify(execFile);

// The poll loop from references/near-intents-funding.md, parameterised on the
// inner status command. Sleep is `sleep 0` for fast tests; the doc uses `sleep 5`.
function buildLoop(stubCmd) {
  return `
    while :; do
      out=$(${stubCmd})
      echo "$out"
      echo "$out" | grep -qE "SUCCESS|REFUNDED|FAILED|INCOMPLETE_DEPOSIT|FATAL" && break
      sleep 0
    done
  `;
}

// Writes a stub shell script that, on each invocation, prints the next status
// from `sequence` and increments a counter on disk. After the sequence is
// exhausted it keeps returning the last entry. An entry containing a colon is
// emitted verbatim (for `FATAL:` / `RETRYING:` lines); a bare status is prefixed.
function writeStub(dir, sequence) {
  const counter = path.join(dir, 'counter');
  const stub = path.join(dir, 'stub.sh');
  const line = (s) => (s.includes(':') ? s : `Status: ${s}`);
  const cases = sequence.map((s, i) => `${i}) echo "${line(s)}" ;;`).join('\n  ');
  const fallback = line(sequence[sequence.length - 1]);
  fs.writeFileSync(stub, `#!/bin/bash
i=$(cat ${counter} 2>/dev/null || echo 0)
case $i in
  ${cases}
  *) echo "${fallback}" ;;
esac
echo $((i+1)) > ${counter}
`, { mode: 0o755 });
  return { stub, counter };
}

async function runLoop(sequence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-test-'));
  try {
    const { stub, counter } = writeStub(dir, sequence);
    const result = await execAsync('bash', ['-c', buildLoop(stub)]);
    const iterations = parseInt(fs.readFileSync(counter, 'utf8').trim(), 10);
    return { stdout: result.stdout, iterations };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('poll loop: iterates through non-terminal states and breaks on SUCCESS', async () => {
  const { stdout, iterations } = await runLoop([
    'PENDING_DEPOSIT',
    'KNOWN_DEPOSIT_TX',
    'PROCESSING',
    'SUCCESS',
  ]);
  assert.match(stdout, /PENDING_DEPOSIT[\s\S]*KNOWN_DEPOSIT_TX[\s\S]*PROCESSING[\s\S]*SUCCESS/);
  assert.equal(iterations, 4, 'expected 4 iterations to reach SUCCESS');
});

for (const terminal of ['SUCCESS', 'REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT']) {
  test(`poll loop: breaks on ${terminal}`, async () => {
    const { stdout, iterations } = await runLoop(['PENDING_DEPOSIT', 'PROCESSING', terminal]);
    assert.match(stdout, new RegExp(`PROCESSING[\\s\\S]*${terminal}`));
    assert.equal(iterations, 3, `expected 3 iterations to reach ${terminal}`);
  });
}

test('poll loop: breaks on a FATAL line', async () => {
  const { stdout, iterations } = await runLoop([
    'PENDING_DEPOSIT',
    'FATAL: Deposit address 0x0000000000000000000000000000000000000001 not found',
  ]);
  assert.match(stdout, /PENDING_DEPOSIT[\s\S]*FATAL/);
  assert.equal(iterations, 2, 'expected the FATAL line to break the loop');
});

test('poll loop: iterates past a RETRYING line', async () => {
  const { stdout, iterations } = await runLoop([
    'RETRYING: upstream error from the status API',
    'PROCESSING',
    'SUCCESS',
  ]);
  assert.match(stdout, /RETRYING[\s\S]*PROCESSING[\s\S]*SUCCESS/);
  assert.equal(iterations, 3, 'expected a transient error to be polled past, not break');
});

test('poll loop: does not break on non-terminal statuses alone', async () => {
  // If every status is non-terminal, the stub falls back to PROCESSING forever.
  // We can't run forever in a test — bound iterations via timeout, then assert
  // the loop was still running (i.e., didn't break early on a non-terminal).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-test-'));
  try {
    const { stub, counter } = writeStub(dir, ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING']);
    // Run with a hard timeout — we expect the timeout to fire, not the loop to break.
    let timedOut = false;
    try {
      await execAsync('bash', ['-c', buildLoop(stub)], { timeout: 500 });
    } catch (e) {
      timedOut = e.killed === true || /timed? out|killed/i.test(e.message);
    }
    assert.ok(timedOut, 'loop should not break on non-terminal statuses (expected timeout)');
    const iterations = parseInt(fs.readFileSync(counter, 'utf8').trim(), 10);
    assert.ok(iterations >= 3, `expected loop to keep iterating; got ${iterations}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
