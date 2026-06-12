// Shared helpers for x402 payment options and USDC amounts — the single source of
// truth for the --max-price guard semantics used by pay.mjs and check-price.mjs.

export const BASE_MAINNET_CHAIN_ID = 8453; // only Base mainnet is supported (no testnets / other chains)
export const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // USDC on Base mainnet (6 decimals)

const CHAIN_IDS = { 'base': BASE_MAINNET_CHAIN_ID };

// Normalize an x402 network field to its numeric EVM chain ID. Handles both the
// CAIP-2 form ("eip155:8453") and the short-name form ("base"); returns null for
// anything unrecognized or malformed (parseInt would accept "eip155:8453garbage").
export function evmChainId(network) {
  if (typeof network !== 'string') return null;
  const caip2 = network.match(/^eip155:(\d+)$/);
  if (caip2) return Number(caip2[1]);
  return CHAIN_IDS[network] ?? null;
}

// Format an atomic USDC amount (6 decimals) as a decimal string, using BigInt so
// large values don't lose precision.
export function formatUsdc(atomic) {
  const v = BigInt(atomic);
  return `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, '0')}`;
}

// Parse a user-supplied USDC decimal string (e.g. "0.0100", up to 6 decimals) to
// atomic units; returns null if the format is invalid.
export function parseUsdcToAtomic(str) {
  const m = String(str).match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  return (BigInt(m[1]) * 1_000_000n) + BigInt((m[2] || '').padEnd(6, '0'));
}

// The amount field of an accepts entry (v1 maxAmountRequired, v2 amount), as a string.
export function optionAmount(opt) {
  return String(opt?.maxAmountRequired ?? opt?.amount ?? '');
}

// True iff this accepts entry is one the --max-price guard can vouch for: exact
// scheme, Base mainnet, Base USDC asset, and a plain-integer atomic amount. The
// asset check matters because amounts are token-atomic units — comparing another
// token's amount against a USDC max is meaningless (different decimals/value).
export function isVerifiableBaseUsdcOption(opt) {
  return opt?.scheme === 'exact'
    && evmChainId(opt.network) === BASE_MAINNET_CHAIN_ID
    && String(opt.asset || '').toLowerCase() === BASE_USDC_ADDRESS
    && /^\d+$/.test(optionAmount(opt));
}

// Filter an accepts array down to verifiable Base USDC options, sorted cheapest
// first (BigInt comparison — no precision loss on huge amounts).
export function baseUsdcOptions(accepts) {
  if (!Array.isArray(accepts)) return [];
  return accepts
    .filter(isVerifiableBaseUsdcOption)
    .sort((a, b) => {
      const av = BigInt(optionAmount(a)), bv = BigInt(optionAmount(b));
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
}
