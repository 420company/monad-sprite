import { zeroAddress } from 'viem';
import type { TokenContext, TransferLog } from '../types.js';

const FIRST_BUY_WINDOW_BLOCKS = 10n;

/**
 * Signal 4 — launch velocity. Reuses the Transfer logs fetched for holders
 * (near-zero marginal RPC cost).
 *
 * - blocksToFirstBuy: blocks from creation to the first mint/buy.
 *   Doc: 0–2 blocks → 20–40; >20 blocks → 70–90.
 * - sniperPct: share of supply minted/bought within the first 10 blocks.
 *   Doc: >30% → 0–20 (+SNIPED); <5% → 70–100.
 */
export function scoreVelocity(
  logs: TransferLog[],
  ctx: TokenContext,
): {
  score: number | null;
  flags: string[];
  checks: { name: string; passed: boolean; detail: string }[];
} {
  const flags: string[] = [];

  const mints = logs.filter((l) => l.from === zeroAddress);
  if (mints.length === 0 || ctx.creationBlock === null) {
    return {
      score: null,
      flags,
      checks: [
        {
          name: 'velocity',
          passed: false,
          detail: 'no buys observed yet — velocity unknown',
        },
      ],
    };
  }

  const firstBuyBlock = mints.reduce(
    (min, l) => (l.blockNumber < min ? l.blockNumber : min),
    mints[0].blockNumber,
  );
  const blocksToFirstBuy = Number(firstBuyBlock - ctx.creationBlock);

  // Sub-part A: time to first buy.
  let speedScore: number;
  if (blocksToFirstBuy <= 2) speedScore = 30;
  else if (blocksToFirstBuy >= 20) speedScore = 80;
  else speedScore = 30 + (50 * (blocksToFirstBuy - 2)) / 18;

  // Sub-part B: sniper concentration in the first 10 blocks.
  const windowEnd = ctx.creationBlock + FIRST_BUY_WINDOW_BLOCKS;
  const sniped = mints
    .filter((l) => l.blockNumber <= windowEnd)
    .reduce((acc, l) => acc + l.value, 0n);
  let sniperPct: number | null = null;
  if (ctx.totalSupply && ctx.totalSupply > 0n) {
    sniperPct = Number((sniped * 10_000n) / ctx.totalSupply) / 100;
  }

  let sniperScore: number | null = null;
  if (sniperPct !== null) {
    if (sniperPct >= 30) {
      sniperScore = 10;
      flags.push('SNIPED');
    } else if (sniperPct <= 5) {
      sniperScore = 85;
    } else {
      sniperScore = 10 + (75 * (30 - sniperPct)) / 25;
    }
  }

  const parts = [speedScore, ...(sniperScore !== null ? [sniperScore] : [])];
  const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);

  return {
    score,
    flags,
    checks: [
      {
        name: 'velocity',
        passed: sniperPct === null || sniperPct < 30,
        detail:
          `first buy ${blocksToFirstBuy} block(s) after creation` +
          (sniperPct !== null
            ? `; ${sniperPct.toFixed(1)}% of supply bought in first 10 blocks`
            : '; sniper share unknown'),
      },
    ],
  };
}
