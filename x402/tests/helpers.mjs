// Shared test helper — runs a script as a child process and returns output.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { config } from 'dotenv';

// Load x402/.env so wallet credentials are available without manually exporting them.
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });

const execAsync = promisify(execFile);
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Well-known Hardhat/Anvil test key — public, no real funds at risk.
export const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Minimal PAYMENT-REQUIRED fixture — x402 v1 format (used by pay.mjs and sign scripts).
export const PAYMENT_REQUIRED_FIXTURE = Buffer.from(JSON.stringify({
  x402Version: 1,
  accepts: [{
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '10000',
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    payTo: '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 60,
    extra: { tokenName: 'USD Coin', tokenVersion: '2' },
  }],
})).toString('base64');

// Minimal PAYMENT-REQUIRED fixture — x402 v2 format (used by @x402/fetch + ExactEvmScheme).
// Note: ExactEvmScheme reads domain params as extra.name / extra.version (not tokenName/tokenVersion).
export const PAYMENT_REQUIRED_V2_FIXTURE = Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url: 'http://localhost/test' },
  accepts: [{
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '10000',
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    payTo: '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 60,
    extra: { name: 'USD Coin', version: '2' },
  }],
})).toString('base64');

export async function run(script, args = [], env = {}) {
  try {
    const result = await execAsync('node', [join('scripts', script), ...args], {
      cwd: SKILL_DIR,
      env: { ...process.env, ...env },
      timeout: 20_000,
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
