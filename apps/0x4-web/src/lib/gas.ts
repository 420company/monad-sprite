// Gas checks and "auto gas top-up" (2026-09-27 goat)
//
// Meme coins the sprite finds live on different chains, each with its own gas token (Solana uses SOL, BSC uses BNB, Base / Ethereum / Arbitrum / Robinhood use ETH).
// Check three things before ordering: is the payment token enough, does the payment chain have gas, does the target chain have gas (needed later to sell) — say exactly what's missing.
//
// Auto gas top-up: the user sets a gas budget (min $10, default $20), kept as BNB on BSC in their own wallet —
//   · BNB is BSC's gas already, and BSC is our main chain — no swap needed;
//   · when other chains run low, swap from BNB in one step (LI.FI). Tested 2026-09-27: ~$2.35 of BNB to Solana / Base / Robinhood / Arbitrum / Ethereum,
//     arrived $2.30–2.33, total fees ~$0.05, arrived in 2–9 seconds;
//   · the "reserve" is only earmarked on paper: the money stays in the user's own wallet; the app never touches this BNB when buying coins, only uses it for gas top-ups.
// Gas top-ups carry no platform fee.
import { BTC_CHAIN_ID, chainById, isGasToken, SOLANA_CHAIN_ID } from './chains'
import { getLifiQuote, executeLifiStep, type ExecPhase, type LiFiStep } from './lifi'
import { REFUEL_FROM_CHAIN, REFUEL_FROM_TOKEN, REFUEL_ORDER, REFUEL_SLIPPAGE, refuelQuoteProblem, type RefuelQuoteLike } from './refuelQuote'
import { cleanFuelChains, fuelChainName, isRouteDown, markRouteDown, markRouteUp } from './fuelChains'
import { toBaseUnits } from './format'
import type { Holding } from './types'
import type { Account } from 'viem'
import type { SolanaWallet } from './vault/signers'
import { t } from './i18n'
import { API_BASE } from './env'

export const BSC = 56
export const RESERVE_MIN_USD = 10
export const RESERVE_DEFAULT_USD = 20

/**
 * Per chain: below minUsd counts as "low on gas"; top-ups bring it to topUpUsd.
 * Solana keeps $1 based on our priority-fee cap (0.005 SOL); L2s cost cents per tx; Ethereum mainnet swaps cost dollars per tx, so it keeps and tops up more.
 */
const GAS_RULE: Record<number, { minUsd: number; topUpUsd: number }> = {
  [SOLANA_CHAIN_ID]: { minUsd: 0.5, topUpUsd: 5 },   // First-time buys of a new token need a token account, deposit ≈ $0.4
  56: { minUsd: 0.1, topUpUsd: 0 },                  // BSC: gas is the BNB reserve itself, no swap needed
  1: { minUsd: 0.5, topUpUsd: 5 },
}
const DEFAULT_RULE = { minUsd: 0.1, topUpUsd: 5 }
/** Minimum $5 per top-up (2026-09-29 goat: $2 is too little). Even if the server computes less, top up $5 */
export const MIN_TOPUP_USD = 5
/** Max for the server-pushed "standard top-up / warning line" (USD). Ethereum mainnet swaps cost dollars each; $10 covers many times; beyond this, don't trust it — use local defaults */
export const MAX_TOPUP_USD = 10
/** Hard cap per actual top-up: before ordering, top up "what this tx needs × 1.2", at most ~$12; any top-up over $50 is definitely abnormal */
export const MAX_REFUEL_USD = 50
const okNum = (x: unknown, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max
/**
 * Server-set standards from measured gas per chain over the last 24h (GET /api/gas/rules, refreshed every 3h): warning line = avg tx × 3, top-up amount = × 10 (min $5).
 * The fixed values above are only a fallback when the server data is unavailable.
 */
let liveRules: Record<number, { minUsd: number; topUpUsd: number }> = {}
let rulesAt = 0
export async function loadGasRules(): Promise<void> {
  if (Date.now() - rulesAt < 30 * 60_000) return
  rulesAt = Date.now()
  try {
    const r = await fetch(`${API_BASE}/api/gas/rules`, { signal: AbortSignal.timeout(8000) })
    if (r.ok) liveRules = ((await r.json()) as { chains: typeof liveRules }).chains || {}
  } catch { rulesAt = 0 }
}
export const gasRule = (chainId: number) => {
  const local = GAS_RULE[chainId] || DEFAULT_RULE
  const live = liveRules[chainId]
  // Server data is used only when all numbers are sane: top-up 0 < x ≤ $10, warning line not above the top-up; otherwise use local defaults, so a server bug or tamper can't make the app swap away a large BNB chunk at once (review #12)
  const r = live && okNum(live.minUsd, MAX_TOPUP_USD) && okNum(live.topUpUsd, MAX_TOPUP_USD) && live.topUpUsd > 0 && live.minUsd <= live.topUpUsd ? live : local
  return chainId === 56 ? { ...r, topUpUsd: 0 } : { ...r, topUpUsd: Math.max(MIN_TOPUP_USD, r.topUpUsd) }
}

/** What the native (gas) token on this chain is worth in USD */
export function nativeUsd(holdings: Holding[], chainId: number): number {
  return holdings.filter((h) => h.chainId === chainId && isGasToken(chainId, h.mint)).reduce((s, h) => s + (h.valueUsd || 0), 0)
}
export function nativeAmount(holdings: Holding[], chainId: number): number {
  return holdings.filter((h) => h.chainId === chainId && isGasToken(chainId, h.mint)).reduce((s, h) => s + h.amount, 0)
}
/**
 * The chain has a gas token but this round got no price (priceUsd recorded as 0 when the price API fails): unknown value must not be treated as 0 for top-ups (2026-09-29 review P2).
 * Only "truly no gas token" counts as 0.
 */
export function nativePriceUnknown(holdings: Holding[], chainId: number): boolean {
  return holdings.some((h) => h.chainId === chainId && isGasToken(chainId, h.mint) && h.amount > 0 && !(h.priceUsd > 0))
}
/** Network problems (timeout, offline, aborted request): don't mean the route is gone — must not be marked "temporarily untoppable" */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  return /timeout|timed out|abort|Failed to fetch|NetworkError|network|Load failed/i.test(e.message)
}
/** Auto top-ups only run while the wallet is unlocked: skip while locked, never pop a verification dialog for auto top-ups (2026-09-29 review P2; manual top-ups unaffected) */
export const canAutoRefuel = (o: { enabled: boolean; hasAccount: boolean; keysUnlocked: boolean; portfolioReady: boolean }) =>
  o.enabled && o.hasAccount && o.keysUnlocked && o.portfolioReady
const gasSymbol = (chainId: number) => chainById(chainId)?.native.symbol || ''
const chainName = (chainId: number) => chainById(chainId)?.name || ''

export interface GasProblem {
  kind: 'pay' | 'gas'
  chainId: number
  /** The missing token (payment token or gas token) */
  symbol: string
  /** Roughly how many USD short */
  needUsd: number
  /** Whether it can be auto-topped from the BNB reserve (gas only) */
  refillable: boolean
}

/**
 * Pre-order check. pay: what and how much (USD); targetChainId: which chain the bought coin lands on (selling later needs that chain's gas);
 * bundledTargetGas: for cross-chain buys the swap already bundled target-chain gas (TradeSheet does this for EVM targets), so the target chain doesn't count as low;
 * reserveUsd: the BNB reserve (passed only when auto top-up is on) — untouchable when paying with BNB
 */
export function checkGas(o: {
  holdings: Holding[]
  pay: { chainId: number; token: string; usd: number; balanceUsd: number }
  targetChainId: number
  bundledTargetGas?: boolean
  reserveUsd?: number
}): GasProblem[] {
  const out: GasProblem[] = []
  const { holdings, pay, targetChainId } = o
  const payNative = isGasToken(pay.chainId, pay.token)
  const reserve = pay.chainId === BSC && payNative ? o.reserveUsd || 0 : 0
  // 1. Is the payment token enough (when paying with BNB, the reserved portion doesn't count as available)
  if (pay.usd > pay.balanceUsd - reserve + 1e-9) out.push({ kind: 'pay', chainId: pay.chainId, symbol: '', needUsd: Math.max(0, pay.usd - (pay.balanceUsd - reserve)), refillable: false })
  // Bitcoin has no separate gas: miner fees come straight out of the BTC (the cross-chain service's tx already accounts for them) — don't check, don't "top up gas" (2026-09-30 Bitcoin flash-swap)
  if (pay.chainId === BTC_CHAIN_ID) {
    if (targetChainId !== BTC_CHAIN_ID && !o.bundledTargetGas) {
      const rule = gasRule(targetChainId)
      const have = nativeUsd(holdings, targetChainId)
      if (have < rule.minUsd) out.push({ kind: 'gas', chainId: targetChainId, symbol: gasSymbol(targetChainId), needUsd: rule.minUsd - have, refillable: targetChainId !== BSC })
    }
    return out
  }
  // 2. Gas on the payment chain: when paying with the native token, gas must remain after paying
  const rulePay = gasRule(pay.chainId)
  const havePay = nativeUsd(holdings, pay.chainId) - (payNative ? pay.usd : 0)
  if (havePay < rulePay.minUsd) out.push({ kind: 'gas', chainId: pay.chainId, symbol: gasSymbol(pay.chainId), needUsd: rulePay.minUsd - Math.max(0, havePay), refillable: pay.chainId !== BSC })
  // 3. Gas on the target chain (same-chain already covered in step 2)
  if (targetChainId !== pay.chainId && targetChainId !== BTC_CHAIN_ID && !o.bundledTargetGas) {
    const rule = gasRule(targetChainId)
    const have = nativeUsd(holdings, targetChainId)
    if (have < rule.minUsd) out.push({ kind: 'gas', chainId: targetChainId, symbol: gasSymbol(targetChainId), needUsd: rule.minUsd - have, refillable: targetChainId !== BSC })
  }
  return out
}

/** User-facing message: say exactly what's missing */
export function describeProblem(p: GasProblem): string {
  if (p.kind === 'pay') return t('付款余额不足，还差约 ${usd}', { usd: p.needUsd.toFixed(2) })
  return t('{chain} 上缺少 {symbol} 作为燃料费（约 ${usd}）', { chain: chainName(p.chainId), symbol: p.symbol, usd: Math.max(0.5, p.needUsd).toFixed(2) })
}

/** How many USD to top up from BSC BNB (one top-up per the rules, at least covering the shortfall) */
export const topUpUsd = (p: GasProblem) => Math.max(gasRule(p.chainId).topUpUsd, Math.ceil(p.needUsd * 1.2 * 100) / 100)

/**
 * Gas top-up quote (quote only, no signature): swap BSC BNB into the target chain's native gas token — params per refuelQuote.ts (same set the measurement scripts use).
 * No route, or a bad quote (payout isn't the gas token, amount is 0) → mark the chain "temporarily untoppable" with a clear message; clear the mark when a quote succeeds.
 */
export async function quoteRefuel(o: { chainId: number; usd: number; bnbPriceUsd: number; evmAddress: string; solanaAddress: string }): Promise<LiFiStep> {
  const target = chainById(o.chainId)
  if (!target || o.chainId === BSC) throw new Error(t('这条链不需要补燃料费'))
  // Last line of defense: the amount must be a sane positive number within the hard cap (manual, auto, and pre-order top-ups all pass through here)
  if (!(Number.isFinite(o.usd) && o.usd > 0 && o.usd <= MAX_REFUEL_USD)) throw new Error(t('补充金额不对'))
  if (!(o.bnbPriceUsd > 0)) throw new Error(t('暂时拿不到 BNB 价格，稍后再试'))
  const toAddress = o.chainId === SOLANA_CHAIN_ID ? o.solanaAddress : o.evmAddress
  if (!toAddress) throw new Error(t('缺少地址'))
  const unavailable = () => new Error(t('{chain} 暂时无法从 BNB 兑换燃料费，请稍后再试', { chain: fuelChainName(target.name) }))
  let quote: LiFiStep
  const fromAmount = toBaseUnits((o.usd / o.bnbPriceUsd).toFixed(8), 18)
  try {
    quote = await getLifiQuote({
      fromChain: REFUEL_FROM_CHAIN, fromToken: REFUEL_FROM_TOKEN, toChain: o.chainId, toToken: target.native.address,
      fromAmount, fromAddress: o.evmAddress, toAddress, slippage: REFUEL_SLIPPAGE, order: REFUEL_ORDER,
    })
  } catch (e) {
    // Dropped network / timeout doesn't mean the route is gone: report the network problem as-is, don't mark "temporarily untoppable"
    if (isNetworkError(e)) throw e
    markRouteDown(o.chainId)
    throw unavailable()
  }
  // Verify the quote item by item: sourced from BNB Chain's BNB, amount matches what we asked, funds go back to the user's own address, payout is this chain's gas token (review P3 — never fully trust the quote API)
  if (refuelQuoteProblem(quote as unknown as RefuelQuoteLike, o.chainId, target.native.address, { fromAmount: fromAmount.toString(), fromAddress: o.evmAddress, toAddress })) { markRouteDown(o.chainId); throw unavailable() }
  markRouteUp(o.chainId)
  return quote
}

/**
 * Swap BSC BNB into the target chain's gas (no platform fee). Needs: enough BNB for usd + a little BSC gas of its own.
 * Order: quote first (stop if no route — no password prompt, no doomed tx sent) → beforeSign (the gas page uses it to ask the user to verify identity, amount shown on the panel) → sign and send.
 * Returns the BSC tx hash.
 */
export async function refuel(o: {
  chainId: number; usd: number; bnbPriceUsd: number; bnbUsd: number
  evm: Account; solana: SolanaWallet | null; solanaRpc: string; evmAddress: string; solanaAddress: string
  onPhase?: (p: ExecPhase) => void
  beforeSign?: () => Promise<void>
}): Promise<string> {
  if (o.bnbUsd < o.usd + gasRule(BSC).minUsd) throw new Error(t('BNB 不足：补燃料费需要约 ${usd} 的 BNB', { usd: (o.usd + gasRule(BSC).minUsd).toFixed(2) }))
  const quote = await quoteRefuel(o)
  await o.beforeSign?.()
  return executeLifiStep(quote, { solana: o.solana, evm: o.evm, solanaRpc: o.solanaRpc }, o.onPhase)
}

/**
 * Gas warning (2026-09-27 goat): this chain still holds tokens (non-native total ≥ $1) but gas is below the safety line — selling would fail.
 * Bitcoin has no "gas token" concept (fees come out of the BTC), so it's not checked.
 */
export interface LowGas { chainId: number; symbol: string; holdingsUsd: number; gasUsd: number; minUsd: number }
export function lowGasChains(holdings: Holding[]): LowGas[] {
  const byChain = new Map<number, number>()
  for (const h of holdings) if (!isGasToken(h.chainId, h.mint) && (h.valueUsd || 0) > 0 && chainById(h.chainId)?.native.symbol !== 'BTC') byChain.set(h.chainId, (byChain.get(h.chainId) || 0) + h.valueUsd)
  const out: LowGas[] = []
  for (const [chainId, usd] of byChain) {
    if (usd < 1 || !chainById(chainId) || nativePriceUnknown(holdings, chainId)) continue
    const gas = nativeUsd(holdings, chainId), min = gasRule(chainId).minUsd
    if (gas < min) out.push({ chainId, symbol: gasSymbol(chainId), holdingsUsd: usd, gasUsd: gas, minUsd: min })
  }
  return out.sort((a, b) => b.holdingsUsd - a.holdingsUsd)
}

/**
 * The gas gauge's three levels (2026-09-29 goat: like a car dashboard gauge, low / middle / high, red / yellow / green).
 * Other chains: below this chain's warning line (minUsd, ≈ 3 txs worth) is low — even selling may fail;
 *   up to 3× the warning line (≈ 9 txs) is middle; above that is high.
 * BNB Chain: BNB pays this chain's own gas and is also the reserve for topping up other chains.
 *   Below this chain's warning line is low; enough for gas but below the reserve amount (user-set amount when auto top-up is on, else the minimum reserve RESERVE_MIN_USD) is middle; at/above is high.
 */
export type FuelLevel = 'low' | 'middle' | 'high'
export function fuelLevel(chainId: number, usd: number, reserveUsd = RESERVE_MIN_USD): FuelLevel {
  const min = gasRule(chainId).minUsd
  if (!(usd >= min)) return 'low'
  if (chainId === BSC) return usd >= Math.max(reserveUsd, RESERVE_MIN_USD) ? 'high' : 'middle'
  return usd >= min * 3 ? 'high' : 'middle'
}

/**
 * Which chain this auto top-up round covers (called by GasWatch, pure function for testability):
 * candidates = chains with tokens but low gas (low) + chains the user added on the gas page whose balance is below the warning line (fuelChains — only chains whose balance was successfully read this round; a failed read doesn't count as 0);
 * exclude BNB Chain itself, chains topped up within 6h, and routes marked temporarily unavailable; BNB must cover this top-up + BNB Chain's own gas; 24h cumulative must not exceed the reserve amount.
 */
export function autoRefuelDue(o: {
  holdings: Holding[]; low: number[]; fuelChains: readonly number[]; scannedChains: readonly number[]
  bnbUsd: number; reserveUsd: number; spentUsd: number; lastAuto: Record<string, number>; now?: number; cooldownMs?: number
}): number | null {
  const now = o.now ?? Date.now(), cooldown = o.cooldownMs ?? 6 * 3600_000
  const added = cleanFuelChains(o.fuelChains).filter((id) => o.scannedChains.includes(id) && nativeUsd(o.holdings, id) < gasRule(id).minUsd)
  const candidates = [...o.low, ...added.filter((id) => !o.low.includes(id))]
  for (const id of candidates) {
    if (id === BSC || isRouteDown(id) || nativePriceUnknown(o.holdings, id)) continue
    if (now - (o.lastAuto[id] || 0) <= cooldown) continue
    const usd = gasRule(id).topUpUsd
    if (o.bnbUsd < usd + gasRule(BSC).minUsd) continue
    if (o.spentUsd + usd > o.reserveUsd) continue
    return id
  }
  return null
}
