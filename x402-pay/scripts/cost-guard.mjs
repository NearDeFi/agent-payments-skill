// Cost guard for cross-chain funding quotes (used by near-intents.mjs).
//
// A NEAR Intents funding quote is rejected when its USD overhead — what you send
// (amountInUsd, the worst-case deposit incl. the slippage buffer) minus what arrives
// (amountOutUsd) — exceeds BOTH thresholds: a high percentage AND a non-trivial
// absolute amount. Requiring both means the $0.005 floor lets tiny top-ups through
// (where a fixed ~$0.0024 fee inflates the %), so the guard's real target is
// illiquid / high-spread source assets, where the % stays high at normal amounts.

export const MAX_OVERHEAD_USD = 0.005;
export const MAX_OVERHEAD_PCT = 2.5;

// Assess a quote's USD overhead. Returns:
//   { computable, overheadUsd, overheadPct, exceeds }
// `computable` is false when the USD figures are missing/invalid (caller should then
// proceed without the check rather than block). `exceeds` is true only when overhead
// is over BOTH the $ and % caps.
export function assessOverhead(inUsd, outUsd, maxUsd = MAX_OVERHEAD_USD, maxPct = MAX_OVERHEAD_PCT) {
  const a = Number(inUsd);
  const b = Number(outUsd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) {
    return { computable: false, overheadUsd: NaN, overheadPct: NaN, exceeds: false };
  }
  const overheadUsd = a - b;
  const overheadPct = (overheadUsd / b) * 100;
  return {
    computable: true,
    overheadUsd,
    overheadPct,
    exceeds: overheadUsd > maxUsd && overheadPct > maxPct,
  };
}
