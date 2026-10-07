import { zeroAddress, type Address } from 'viem';
import type { TokenContext, TransferLog } from '../types.js';

/** Rebuild per-address balances from Transfer logs (mints add, burns remove). */
export function buildBalances(logs: TransferLog[]): Map<Address, bigint> {
  const balances = new Map<Address, bigint>();
  for (const l of logs) {
    if (l.from !== zeroAddress) {
      balances.set(l.from, (balances.get(l.from) ?? 0n) - l.value);
    }
    if (l.to !== zeroAddress) {
      balances.set(l.to, (balances.get(l.to) ?? 0n) + l.value);
    }
  }
  // Drop dust/zeroed entries.
  for (const [addr, bal] of balances) {
    if (bal <= 0n) balances.delete(addr);
  }
  return balances;
}

export interface HolderStats {
  holderCount: number;
  top10SharePct: number | null;
}

/** Top-10 share of totalSupply, from reconstructed balances. */
export function holderStats(
  logs: TransferLog[],
  totalSupply: bigint | null,
): HolderStats {
  const balances = buildBalances(logs);
  const sorted = [...balances.values()].sort((a, b) => (a > b ? -1 : 1));
  const top10 = sorted.slice(0, 10).reduce((acc, v) => acc + v, 0n);

  let top10SharePct: number | null = null;
  if (totalSupply && totalSupply > 0n) {
    top10SharePct = Number((top10 * 10_000n) / totalSupply) / 100;
  }
  return { holderCount: balances.size, top10SharePct };
}

/**
 * Signal 3 — holder concentration (top-10 share).
 * Doc bands: >80% → 0–15; 50–80% → 15–50; 40–50% → 50–70; <40% → 70–100.
 */
export function scoreHolders(
  logs: TransferLog[],
  ctx: TokenContext,
): {
  score: number | null;
  flags: string[];
  checks: { name: string; passed: boolean; detail: string }[];
  stats: HolderStats;
} {
  const stats = holderStats(logs, ctx.totalSupply);
  const flags: string[] = [];

  if (stats.top10SharePct === null) {
    return {
      score: null,
      flags,
      checks: [
        {
          name: 'concentration',
          passed: false,
          detail: 'totalSupply unreadable — cannot compute top-10 share',
        },
      ],
      stats,
    };
  }

  const s = stats.top10SharePct;
  let score: number;
  if (s >= 80) score = (15 * (100 - s)) / 20;
  else if (s >= 50) score = 15 + (35 * (80 - s)) / 30;
  else if (s >= 40) score = 50 + (20 * (50 - s)) / 10;
  else score = 70 + (30 * (40 - s)) / 40;
  score = Math.max(0, Math.min(100, Math.round(score)));

  if (s > 70) flags.push('CONCENTRATED');

  return {
    score,
    flags,
    checks: [
      {
        name: 'concentration',
        passed: s <= 70,
        detail: `top-10 holders own ${s.toFixed(1)}% across ${
          stats.holderCount
        } holders (${logs.length} transfers scanned)`,
      },
    ],
    stats,
  };
}
