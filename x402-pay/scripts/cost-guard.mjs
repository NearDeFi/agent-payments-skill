// Cost guard for cross-chain funding quotes (used by near-intents.mjs).
//
// A NEAR Intents funding quote is rejected when its USD overhead — what you send
// (amountInUsd, the worst-case deposit incl. the slippage buffer) minus what arrives
// (amountOutUsd) — exceeds BOTH thresholds: a high percentage AND an absolute amount.

export const MAX_OVERHEAD_USD = 0.005;
export const MAX_OVERHEAD_PCT = 2.5;

// Assess a quote's USD overhead. Returns { overheadUsd, overheadPct, exceeds };
// `exceeds` is true only when overhead is over BOTH the $ and % caps. Throws if the
// USD figures are missing/invalid — the caller should let that fail closed (no funding)
// rather than spend without being able to verify the cost.
export function assessOverhead(inUsd, outUsd, maxUsd = MAX_OVERHEAD_USD, maxPct = MAX_OVERHEAD_PCT) {
  const a = Number(inUsd);
  const b = Number(outUsd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) {
    throw new Error(`Cannot verify funding cost — invalid USD figures in quote (amountInUsd=${inUsd}, amountOutUsd=${outUsd}).`);
  }
  const overheadUsd = a - b;
  const overheadPct = (overheadUsd / b) * 100;
  return { overheadUsd, overheadPct, exceeds: overheadUsd > maxUsd && overheadPct > maxPct };
}
