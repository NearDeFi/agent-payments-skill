// Shared test helper — runs a script as a child process and returns output.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { config } from 'dotenv';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-payments');

// Load agent-payments/.env so wallet credentials are available without manually exporting them.
config({ path: join(SKILL_DIR, '.env'), quiet: true });

const execAsync = promisify(execFile);

// Well-known Hardhat/Anvil test key — public, no real funds at risk.
export const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Minimal payment requirements fixture — x402 v1 format (used by pay.mjs and sign scripts).
export const PAYMENT_REQUIRED_FIXTURE = Buffer.from(JSON.stringify({
  x402Version: 1,
  accepts: [{
    scheme: 'exact',
    network: 'base',
    maxAmountRequired: '10000',
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    payTo: '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 60,
    extra: { name: 'USD Coin', version: '2' },
  }],
})).toString('base64');

export async function run(script, args = [], env = {}, { timeout = 30_000 } = {}) {
  try {
    const result = await execAsync('node', [join('scripts', script), ...args], {
      cwd: SKILL_DIR,
      env: { ...process.env, ...env },
      timeout,
    });
    return { code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (e) {
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: (e.stdout ?? '').trim(),
      stderr: (e.stderr ?? '').trim(),
    };
  }
}
