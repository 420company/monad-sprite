import { formatEther, type Address } from 'viem';
import { launcherAbi } from '../abi.js';
import type { PublicClient } from '../client.js';
import { LAUNCHER_ADDRESS } from '../config.js';
import type { SignalResult, TokenContext } from '../types.js';

/**
 * Signal 2 — liquidity depth.
 *
 * First-class path: tokens launched by our MemeLauncher expose their MON
 * reserve directly via tokens(token).reserve — no DEX needed on testnet.
 * Generic ERC-20s have no discoverable pool on testnet, so this signal
 * returns a pending (null) score for them.
 */
export async function scoreLiquidity(
  client: PublicClient,
  ctx: TokenContext,
): Promise<SignalResult> {
  const token: Address = ctx.token;

  if (!ctx.isLauncherToken) {
    return {
      signal: 'liquidity',
      score: null,
      flags: [],
      checks: [
        {
          name: 'depth',
          passed: false,
          detail:
            'not a MemeLauncher token and no DEX pool is discoverable on testnet — liquidity unknown',
        },
      ],
    };
  }

  const flags: string[] = [];
  let info;
  try {
    info = await client.readContract({
      address: LAUNCHER_ADDRESS,
      abi: launcherAbi,
      functionName: 'tokens',
      args: [token],
    });
  } catch {
    return {
      signal: 'liquidity',
      score: null,
      flags: [],
      checks: [
        { name: 'depth', passed: false, detail: 'failed to read curve state' },
      ],
    };
  }

  const reserveMon = Number(formatEther(info[2])); // reserve in MON
  const supply = info[1];

  // Doc mapping, log-scale: <10 MON → 0–20; 10–100 → 20–60; >100 → 60–100.
  let score: number;
  if (reserveMon < 10) {
    score = (20 * reserveMon) / 10;
  } else if (reserveMon <= 100) {
    score = 20 + 40 * (Math.log10(reserveMon / 10) / 1);
  } else {
    score = 60 + 40 * Math.min(1, Math.log10(reserveMon / 100) / 3);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  if (reserveMon < 10) {
    flags.push('LOW_LIQUIDITY');
  }

  return {
    signal: 'liquidity',
    score,
    flags,
    checks: [
      {
        name: 'depth',
        passed: reserveMon >= 10,
        detail: `bonding-curve reserve ${reserveMon.toFixed(
          4,
        )} MON backing ${supply.toString()} base units`,
      },
    ],
  };
}
