import { isAddress, type Address } from 'viem';
import { publicClient } from './client.js';
import { CHAIN_ID, WEIGHTS } from './config.js';
import { scoreContractRisks } from './signals/contractRisks.js';
import { scoreCreator } from './signals/creator.js';
import { scoreHolders } from './signals/holders.js';
import { scoreLiquidity } from './signals/liquidity.js';
import { fetchTransferLogs, resolveTokenContext } from './signals/transfers.js';
import { scoreVelocity } from './signals/velocity.js';
import type {
  CheckResult,
  RiskBand,
  ScoreResponse,
  SignalResult,
} from './types.js';

const FLAG_WORDS: Record<string, string> = {
  MINTABLE: 'owner can mint new tokens',
  HIGH_TAX: 'transfer tax functions present',
  LOW_LIQUIDITY: 'liquidity below 10 MON',
  SNIPED: 'heavily sniped at launch',
  CONCENTRATED: 'top 10 hold over 70%',
  BLACKLISTABLE: 'blacklist/freeze functions present',
  PROXY_UPGRADEABLE: 'upgradeable proxy contract',
  HONEYPOT_SUSPECT: 'possible honeypot restrictions',
  SERIAL_LAUNCHER: 'deployer launched 3+ tokens before',
  FRESH_DEPLOYER: 'deployer wallet is brand new',
};

function bandFor(score: number): RiskBand {
  if (score >= 80) return 'LOW';
  if (score >= 50) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Score a token address. Each signal is isolated in try/catch so one
 * failing probe degrades to "pending" instead of killing the whole score.
 * Read-only: no wallet, no signing, no transactions.
 */
export async function scoreToken(tokenInput: string): Promise<ScoreResponse> {
  if (!isAddress(tokenInput)) {
    throw new Error(`invalid token address: ${tokenInput}`);
  }
  const token = tokenInput as Address;

  const ctx = await resolveTokenContext(publicClient, token);

  // Contract risks run first (no log scanning, densest signal).
  const contract = await safeSignal(() => scoreContractRisks(publicClient, token), 'contract');

  // Liquidity needs only the launcher view — cheap.
  const liquidity = await safeSignal(() => scoreLiquidity(publicClient, ctx), 'liquidity');

  // Holders + velocity share one Transfer-log scan.
  let holders: SignalResult = pending('holders', 'log scan unavailable');
  let velocity: SignalResult = pending('velocity', 'log scan unavailable');
  if (ctx.creationBlock !== null) {
    try {
      const logs = await fetchTransferLogs(publicClient, token, ctx.creationBlock);
      holders = wrap('holders', scoreHolders(logs, ctx));
      velocity = wrap('velocity', scoreVelocity(logs, ctx));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      holders = pending('holders', `log scan failed: ${detail}`);
      velocity = pending('velocity', `log scan failed: ${detail}`);
    }
  } else if (ctx.isLauncherToken) {
    holders = pending('holders', 'creation block not found');
    velocity = pending('velocity', 'creation block not found');
  } else {
    holders = pending('holders', 'not a MemeLauncher token — holder scan needs a creation block');
    velocity = pending('velocity', 'not a MemeLauncher token — velocity needs a creation block');
  }

  const creator = await safeSignal(() => scoreCreator(publicClient, ctx), 'creator');

  const signals: SignalResult[] = [contract, liquidity, holders, velocity, creator];

  // Composite: weighted average over available (non-null) signals, reweighted.
  const available = signals.filter((s) => s.score !== null) as (SignalResult & {
    score: number;
  })[];
  let score: number | null = null;
  let band: RiskBand | null = null;
  if (available.length > 0) {
    const weightSum = available.reduce(
      (acc, s) => acc + WEIGHTS[s.signal as keyof typeof WEIGHTS],
      0,
    );
    const weighted = available.reduce(
      (acc, s) => acc + s.score * WEIGHTS[s.signal as keyof typeof WEIGHTS],
      0,
    );
    score = Math.round(weighted / weightSum);
    band = bandFor(score);
  }

  const flags = [...new Set(signals.flatMap((s) => s.flags))];
  const allChecks = signals.flatMap((s) => s.checks);
  const checksPassed = allChecks.filter((c) => c.passed).length;

  const breakdown: Record<string, number | null> = {};
  for (const s of signals) breakdown[s.signal] = s.score;

  const verdict = buildVerdict(band, score, flags, checksPassed, allChecks.length);

  return {
    tokenAddress: token,
    chainId: CHAIN_ID,
    score,
    band,
    flags,
    breakdown,
    verdict,
    checksPassed,
    checksTotal: allChecks.length,
    scannedAt: new Date().toISOString(),
  };
}

function buildVerdict(
  band: RiskBand | null,
  score: number | null,
  flags: string[],
  passed: number,
  total: number,
): string {
  if (band === null || score === null) {
    return `Risk UNKNOWN — not enough on-chain data to score. ${passed}/${total} checks passed.`;
  }
  const top = flags
    .slice(0, 2)
    .map((f) => FLAG_WORDS[f] ?? f.toLowerCase().replace(/_/g, ' '));
  const reason = top.length > 0 ? top.join(', ') : 'no major red flags';
  return `Risk ${band} (${score}/100) — ${reason}. ${passed}/${total} checks passed.`;
}

function pending(signal: string, detail: string): SignalResult {
  return {
    signal,
    score: null,
    flags: [],
    checks: [{ name: signal, passed: false, detail }],
  };
}

function wrap(
  signal: string,
  r: { score: number | null; flags: string[]; checks: CheckResult[] },
): SignalResult {
  return { signal, ...r };
}

async function safeSignal(
  fn: () => Promise<SignalResult>,
  signal: string,
): Promise<SignalResult> {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return pending(signal, `probe failed: ${detail}`);
  }
}
