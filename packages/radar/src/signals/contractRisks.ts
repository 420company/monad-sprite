import { toFunctionSelector, zeroAddress, type Address } from 'viem';
import { erc20Abi } from '../abi.js';
import type { PublicClient } from '../client.js';
import { LAUNCHER_ADDRESS } from '../config.js';
import type { CheckResult, SignalResult } from '../types.js';

/** EIP-1967 implementation slot. */
const IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

const MINT_SIGNATURES = [
  'mint(address,uint256)',
  'mint(address)',
  'mint(uint256)',
];
const BLACKLIST_SIGNATURES = [
  'blacklist(address)',
  'addBlacklist(address)',
  'removeBlacklist(address)',
  'setBlacklist(address,bool)',
  'blacklisted(address)',
  'isBlacklisted(address)',
  'freeze(address)',
  'freezeAccount(address)',
  'pause()',
  'unpause()',
];
const TAX_SIGNATURES = [
  'setBuyFee(uint256)',
  'setSellFee(uint256)',
  'buyFee()',
  'sellFee()',
  'setTaxFee(uint256)',
  'taxFee()',
  'setFee(uint256)',
  'setFees(uint256,uint256)',
];

async function bytecodeHas(
  client: PublicClient,
  token: Address,
  selector: string,
): Promise<boolean> {
  try {
    const code = await client.getBytecode({ address: token });
    if (!code || code === '0x') return false;
    return code.toLowerCase().includes(selector.slice(2).toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Signal 1 — contract risks. Pure eth_call / getBytecode / getStorageAt probes,
 * no log scanning. Highest signal-per-effort.
 */
export async function scoreContractRisks(
  client: PublicClient,
  token: Address,
): Promise<SignalResult> {
  const flags: string[] = [];
  const checks: CheckResult[] = [];
  let score = 100;

  const mintSelectors = MINT_SIGNATURES.map(toFunctionSelector);
  const blacklistSelectors = BLACKLIST_SIGNATURES.map(toFunctionSelector);
  const taxSelectors = TAX_SIGNATURES.map(toFunctionSelector);

  // --- mint probe ---
  const mintHits = (
    await Promise.all(
      mintSelectors.map((s) => bytecodeHas(client, token, s)),
    )
  ).filter(Boolean).length;
  const hasMint = mintHits > 0;

  // First-class nuance: our MemeToken exposes launcher(); mint gated by the
  // known launcher is by-design (mint-on-buy), not a rug vector.
  let launcherGated = false;
  if (hasMint) {
    try {
      const launcher = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'launcher',
      });
      launcherGated =
        launcher.toLowerCase() === LAUNCHER_ADDRESS.toLowerCase();
    } catch {
      launcherGated = false;
    }
  }

  let owner: Address | null = null;
  try {
    const o = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'owner',
    });
    owner = o.toLowerCase() === zeroAddress ? null : o;
  } catch {
    owner = null;
  }

  if (hasMint && launcherGated) {
    score -= 15;
    checks.push({
      name: 'mint',
      passed: true,
      detail:
        'mint() present but gated by the known MemeLauncher (mint-on-buy by design)',
    });
  } else if (hasMint) {
    score -= 60;
    flags.push('MINTABLE');
    checks.push({
      name: 'mint',
      passed: false,
      detail: `mint() present in bytecode${
        owner ? ` and owner() = ${owner}` : ''
      } — new supply can be created`,
    });
  } else {
    checks.push({
      name: 'mint',
      passed: true,
      detail: 'no mint function detected in bytecode',
    });
  }

  // --- blacklist / freeze / pause probe ---
  const blacklistHits = (
    await Promise.all(
      blacklistSelectors.map((s) => bytecodeHas(client, token, s)),
    )
  ).filter(Boolean).length;
  if (blacklistHits > 0) {
    score -= 40;
    flags.push('BLACKLISTABLE');
    checks.push({
      name: 'blacklist',
      passed: false,
      detail: `${blacklistHits} blacklist/freeze/pause selector(s) in bytecode — transfers can be censored`,
    });
  } else {
    checks.push({
      name: 'blacklist',
      passed: true,
      detail: 'no blacklist/freeze/pause selectors detected',
    });
  }

  // --- fee/tax probe (heuristic) ---
  const taxHits = (
    await Promise.all(taxSelectors.map((s) => bytecodeHas(client, token, s)))
  ).filter(Boolean).length;
  if (taxHits > 0) {
    score -= 25;
    flags.push('HIGH_TAX');
    checks.push({
      name: 'tax',
      passed: false,
      detail: `${taxHits} fee/tax setter/getter selector(s) in bytecode — transfer taxes possible, verify on-chain`,
    });
  } else {
    checks.push({
      name: 'tax',
      passed: true,
      detail: 'no fee/tax function selectors detected',
    });
  }

  // --- proxy upgradeability probe ---
  try {
    const impl = await client.getStorageAt({ address: token, slot: IMPL_SLOT });
    const isProxy = !!impl && BigInt(impl) !== 0n;
    if (isProxy) {
      score -= 30;
      flags.push('PROXY_UPGRADEABLE');
      checks.push({
        name: 'proxy',
        passed: false,
        detail: `EIP-1967 implementation slot is set (${impl}) — logic can be swapped`,
      });
    } else {
      checks.push({
        name: 'proxy',
        passed: true,
        detail: 'EIP-1967 implementation slot empty — not an upgradeable proxy',
      });
    }
  } catch {
    checks.push({
      name: 'proxy',
      passed: true,
      detail: 'implementation slot unreadable — treated as non-proxy',
    });
  }

  score = Math.max(0, Math.min(100, score));
  return { signal: 'contract', score, flags, checks };
}
