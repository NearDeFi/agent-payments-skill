// Shared test helper — runs a script as a child process and returns output.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { config } from 'dotenv';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'x402-pay');

// Load x402-pay/.env so wallet credentials are available without manually exporting them.
config({ path: join(SKILL_DIR, '.env'), quiet: true });

const execAsync = promisify(execFile);

// Well-known Hardhat/Anvil test key — public, no real funds at risk.
export const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// EIP-712 TransferWithAuthorization payload for a representative x402 "exact" payment on
// Base (USDC) — the input the wallet signing tests feed to each documented `signTypedData`.
// This is the exact shape @x402/fetch hands the signer at runtime, including the uint256
// fields (value, validAfter, validBefore) as BigInt — see @x402/evm's exact client. Keeping
// them as BigInt here is what lets the Privy test catch a missing JSON-BigInt replacer.
// The nonce and time fields are frozen to fixed values (the tests only assert signature
// shape, not content); `message.from` is a placeholder each test overwrites with its own
// wallet address. Clone before mutating: structuredClone(...).
export const PAYMENT_PAYLOAD_FIXTURE = {
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: '<YOUR_WALLET_ADDRESS>',
    to: '0x1234567890123456789012345678901234567890',
    value: 10000n,
    validAfter: 0n,
    validBefore: 1780335420n,
    nonce: '0x6ff27da3a8f7a6a214485e088c4f0fbad450c3b3bcdb0e39ccf18cd369993769',
  },
};

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
