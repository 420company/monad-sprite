import type { PublicClient } from '../client.js';
import type { SignalResult, TokenContext } from '../types.js';

/**
 * Signal 5 — creator history (MVP scope: deployer identity + tx-count heuristic).
 *
 * Full serial-launcher detection (scanning a deployer's past contract creations)
 * needs an indexer and is explicitly deferred in the design doc. The tx-count
 * heuristic below is a cheap, honest prior: a wallet with ~2 transactions that
 * just launched a token is "fresh", not necessarily malicious.
 */
export async function scoreCreator(
  client: PublicClient,
  ctx: TokenContext,
): Promise<SignalResult> {
  const flags: string[] = [];

  if (!ctx.creator) {
    return {
      signal: 'creator',
      score: null,
      flags,
      checks: [
        {
          name: 'deployer',
          passed: false,
          detail:
            'creator not resolvable (not a MemeLauncher token) — serial-launcher scan deferred',
        },
      ],
    };
  }

  let txCount: number | null = null;
  try {
    txCount = await client.getTransactionCount({ address: ctx.creator });
  } catch {
    txCount = null;
  }

  if (txCount === null) {
    return {
      signal: 'creator',
      score: null,
      flags,
      checks: [
        {
          name: 'deployer',
          passed: false,
          detail: 'could not read deployer transaction count',
        },
      ],
    };
  }

  let score: number;
  if (txCount <= 2) {
    score = 45;
    flags.push('FRESH_DEPLOYER');
  } else if (txCount <= 10) {
    score = 60;
  } else {
    score = 75;
  }

  return {
    signal: 'creator',
    score,
    flags,
    checks: [
      {
        name: 'deployer',
        passed: txCount > 2,
        detail: `creator ${ctx.creator} has ${txCount} on-chain transaction(s)${
          txCount <= 2 ? ' — fresh wallet, treat with mild caution' : ''
        }`,
      },
    ],
  };
}
