// 燃料费（gas）检查与「自动补充燃料费」（2026-09-27 goat）
//
// 小精灵找的 meme 币分布在不同链上，每条链的燃料费币种不一样（Solana 用 SOL，BSC 用 BNB，Base / 以太坊 / Arbitrum / Robinhood 用 ETH）。
// 下单前检查三样：付款的币够不够、付款那条链有没有燃料费、目标链有没有燃料费（以后卖出要用），缺哪样说哪样。
//
// 自动补充燃料费：用户设一个燃料预算（最少 10 美元，默认 20），以 BNB 的形式放在自己钱包的 BSC 上 ——
//   · BNB 本身就是 BSC 的燃料费，我们的主力链不用换；
//   · 其它链缺燃料费时，从 BNB 一步换过去（LI.FI）。2026-09-27 实测约 2.35 美元的 BNB 换到 Solana / Base / Robinhood / Arbitrum / 以太坊，
//     到账 2.30~2.33 美元，手续费合计约 0.05 美元，2~9 秒到账；
//   · 「预存」只是账面上留出来：钱一直在用户自己的钱包里，App 买币时不动这部分 BNB，只拿它补燃料费。
// 补燃料费不收平台手续费。
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
 * 每条链：低于 minUsd 就算「缺燃料费」，补的时候补 topUpUsd。
 * Solana 按我们设的优先费上限（0.005 SOL）留 1 美元；L2 一笔几美分；以太坊主网一笔兑换就要几美元，留得多、补得多。
 */
const GAS_RULE: Record<number, { minUsd: number; topUpUsd: number }> = {
  [SOLANA_CHAIN_ID]: { minUsd: 0.5, topUpUsd: 5 },   // 第一次买新币要开代币账户，押金约 0.4 美元
  56: { minUsd: 0.1, topUpUsd: 0 },                  // BSC：燃料费就是 BNB 预存本身，不用换
  1: { minUsd: 0.5, topUpUsd: 5 },
}
const DEFAULT_RULE = { minUsd: 0.1, topUpUsd: 5 }
/** 一次补充最少 5 美元（2026-09-29 goat：补 2 美元太少）。服务器算出来更少也按 5 美元补 */
export const MIN_TOPUP_USD = 5
/** 服务器下发的「标准补充量 / 警戒线」最多这么多（美元）。以太坊主网一笔兑换几美元，补 10 美元够用很多次；超过就不信，用本地默认 */
export const MAX_TOPUP_USD = 10
/** 实际一次补充的硬上限：下单前按「这笔需要的 × 1.2」补，最多约 12 美元；超过 50 美元的补充一定不正常 */
export const MAX_REFUEL_USD = 50
const okNum = (x: unknown, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max
/**
 * 服务器按各链最近 24 小时实测的燃料费定的标准（GET /api/gas/rules，每 3 小时更新）：警戒线 = 平均一笔 × 3，补充量 = × 10（最少 5 美元）。
 * 上面的固定值只在拿不到服务器数据时兜底。
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
  // 服务器数据只在都是合理数字时才用：补充量 0 < x ≤ 10 美元、警戒线不超过补充量；否则用本地默认值，防止服务器出错或被篡改让 App 一次换走一大笔 BNB（审查 #12）
  const r = live && okNum(live.minUsd, MAX_TOPUP_USD) && okNum(live.topUpUsd, MAX_TOPUP_USD) && live.topUpUsd > 0 && live.minUsd <= live.topUpUsd ? live : local
  return chainId === 56 ? { ...r, topUpUsd: 0 } : { ...r, topUpUsd: Math.max(MIN_TOPUP_USD, r.topUpUsd) }
}

/** 这条链上的原生币（燃料费）值多少美元 */
export function nativeUsd(holdings: Holding[], chainId: number): number {
  return holdings.filter((h) => h.chainId === chainId && isGasToken(chainId, h.mint)).reduce((s, h) => s + (h.valueUsd || 0), 0)
}
export function nativeAmount(holdings: Holding[], chainId: number): number {
  return holdings.filter((h) => h.chainId === chainId && isGasToken(chainId, h.mint)).reduce((s, h) => s + h.amount, 0)
}
/**
 * 这条链有燃料费币、但这次没拿到价格（价格接口失败时 priceUsd 记成 0）：值多少不知道，不能当成 0 去补（2026-09-29 审查 P2）。
 * 只有「确实没有燃料费币」才算 0。
 */
export function nativePriceUnknown(holdings: Holding[], chainId: number): boolean {
  return holdings.some((h) => h.chainId === chainId && isGasToken(chainId, h.mint) && h.amount > 0 && !(h.priceUsd > 0))
}
/** 网络问题（超时、断网、请求被中止）：不代表这条路线没了，不该打「暂不可补」 */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  return /timeout|timed out|abort|Failed to fetch|NetworkError|network|Load failed/i.test(e.message)
}
/** 自动补充只在钱包已解锁时进行：锁着就跳过，不为自动补充弹验证框（2026-09-29 审查 P2，手动补充不受影响） */
export const canAutoRefuel = (o: { enabled: boolean; hasAccount: boolean; keysUnlocked: boolean; portfolioReady: boolean }) =>
  o.enabled && o.hasAccount && o.keysUnlocked && o.portfolioReady
const gasSymbol = (chainId: number) => chainById(chainId)?.native.symbol || ''
const chainName = (chainId: number) => chainById(chainId)?.name || ''

export interface GasProblem {
  kind: 'pay' | 'gas'
  chainId: number
  /** 缺的币（付款币或燃料费币） */
  symbol: string
  /** 大约还差多少美元 */
  needUsd: number
  /** 能不能从 BNB 预存里自动补（只有燃料费能补） */
  refillable: boolean
}

/**
 * 下单前检查。pay：付什么、付多少（美元）；targetChainId：买到的币在哪条链（以后卖出要那条链的燃料费）；
 * bundledTargetGas：跨链买入时兑换已经顺带换了目标链燃料费（TradeSheet 对 EVM 目标会这么做），目标链就不算缺；
 * reserveUsd：BNB 预存（开了自动补充才传），付款用 BNB 时这部分不能动
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
  // 1. 付款的币够不够（用 BNB 付时，预存的那部分不算可用）
  if (pay.usd > pay.balanceUsd - reserve + 1e-9) out.push({ kind: 'pay', chainId: pay.chainId, symbol: '', needUsd: Math.max(0, pay.usd - (pay.balanceUsd - reserve)), refillable: false })
  // 比特币没有单独的燃料费：矿工费直接从这笔 BTC 里出（跨链服务给的交易已经算好），不检查、也不去「补燃料费」（2026-09-30 比特币闪兑）
  if (pay.chainId === BTC_CHAIN_ID) {
    if (targetChainId !== BTC_CHAIN_ID && !o.bundledTargetGas) {
      const rule = gasRule(targetChainId)
      const have = nativeUsd(holdings, targetChainId)
      if (have < rule.minUsd) out.push({ kind: 'gas', chainId: targetChainId, symbol: gasSymbol(targetChainId), needUsd: rule.minUsd - have, refillable: targetChainId !== BSC })
    }
    return out
  }
  // 2. 付款那条链的燃料费：付原生币时，付完还要剩下燃料费
  const rulePay = gasRule(pay.chainId)
  const havePay = nativeUsd(holdings, pay.chainId) - (payNative ? pay.usd : 0)
  if (havePay < rulePay.minUsd) out.push({ kind: 'gas', chainId: pay.chainId, symbol: gasSymbol(pay.chainId), needUsd: rulePay.minUsd - Math.max(0, havePay), refillable: pay.chainId !== BSC })
  // 3. 目标链的燃料费（同链已经在第 2 条查过）
  if (targetChainId !== pay.chainId && targetChainId !== BTC_CHAIN_ID && !o.bundledTargetGas) {
    const rule = gasRule(targetChainId)
    const have = nativeUsd(holdings, targetChainId)
    if (have < rule.minUsd) out.push({ kind: 'gas', chainId: targetChainId, symbol: gasSymbol(targetChainId), needUsd: rule.minUsd - have, refillable: targetChainId !== BSC })
  }
  return out
}

/** 给用户看的提示：缺哪样说哪样 */
export function describeProblem(p: GasProblem): string {
  if (p.kind === 'pay') return t('付款余额不足，还差约 ${usd}', { usd: p.needUsd.toFixed(2) })
  return t('{chain} 上缺少 {symbol} 作为燃料费（约 ${usd}）', { chain: chainName(p.chainId), symbol: p.symbol, usd: Math.max(0.5, p.needUsd).toFixed(2) })
}

/** 从 BSC 上的 BNB 补多少美元（按规则补一次，最少补够缺口） */
export const topUpUsd = (p: GasProblem) => Math.max(gasRule(p.chainId).topUpUsd, Math.ceil(p.needUsd * 1.2 * 100) / 100)

/**
 * 补燃料费的报价（只报价，不签名）：从 BSC 的 BNB 换目标链的原生燃料费币，参数见 refuelQuote.ts（实测脚本用的同一套）。
 * 拿不到路线、或报价不对（到账不是燃料费币、数量为 0）就把这条链记成「暂不可补」并报一句清楚的话；拿到了就清掉这个记号。
 */
export async function quoteRefuel(o: { chainId: number; usd: number; bnbPriceUsd: number; evmAddress: string; solanaAddress: string }): Promise<LiFiStep> {
  const target = chainById(o.chainId)
  if (!target || o.chainId === BSC) throw new Error(t('这条链不需要补燃料费'))
  // 最后一道：金额必须是合理的正数，且不超过硬上限（手动补、自动补、下单前补都经过这里）
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
    // 网络断了、超时不算路线没了：原样报网络问题，不打「暂不可补」
    if (isNetworkError(e)) throw e
    markRouteDown(o.chainId)
    throw unavailable()
  }
  // 报价逐项核对：从 BNB Chain 的 BNB 出、金额和我们要的一致、钱打回本人地址、到账是这条链的燃料费币（审查 P3，不全信报价接口）
  if (refuelQuoteProblem(quote as unknown as RefuelQuoteLike, o.chainId, target.native.address, { fromAmount: fromAmount.toString(), fromAddress: o.evmAddress, toAddress })) { markRouteDown(o.chainId); throw unavailable() }
  markRouteUp(o.chainId)
  return quote
}

/**
 * 从 BSC 的 BNB 换目标链的燃料费（不收平台手续费）。需要：BNB 够 usd + BSC 自己的一点燃料费。
 * 顺序：先报价（拿不到路线就停，不会弹密码、不会发出注定失败的交易）→ beforeSign（燃料费页用它请用户验证身份，面板上写着金额）→ 签名发送。
 * 返回 BSC 上的交易哈希。
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
 * 燃料费预警（2026-09-27 goat）：这条链上还有币（非原生币合计 ≥ 1 美元），但燃料费低于安全线 —— 卖出时会失败。
 * 比特币链没有「燃料费币」的概念（手续费从 BTC 里扣），不查。
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
 * 燃料费油量表的三档（2026-09-29 goat：像汽车仪表盘的油量表，low / middle / high，红 / 黄 / 绿）。
 * 其他链：低于这条链的警戒线（minUsd，约够 3 笔交易）是 low，卖出都可能失败；
 *   到警戒线 3 倍（约够 9 笔）之前是 middle；再往上是 high。
 * BNB Chain：BNB 既付这条链自己的燃料费，也是给其他链补燃料费的预存。
 *   连这条链的警戒线都不到是 low；够付燃料费、但没到预存金额（开了自动补充用用户设的金额，否则按最少预存 RESERVE_MIN_USD）是 middle；到了是 high。
 */
export type FuelLevel = 'low' | 'middle' | 'high'
export function fuelLevel(chainId: number, usd: number, reserveUsd = RESERVE_MIN_USD): FuelLevel {
  const min = gasRule(chainId).minUsd
  if (!(usd >= min)) return 'low'
  if (chainId === BSC) return usd >= Math.max(reserveUsd, RESERVE_MIN_USD) ? 'high' : 'middle'
  return usd >= min * 3 ? 'high' : 'middle'
}

/**
 * 自动补充这一轮补哪条链（GasWatch 调用，纯函数便于测试）：
 * 候选 = 有币却缺燃料费的链（low）+ 用户在燃料费页添加的链里余额低于警戒线的（fuelChains，只看这次成功读到余额的链，读失败不当成 0）；
 * 去掉 BNB Chain 本身、6 小时内补过的、路线暂不可用的；BNB 要够这次补充 + BNB Chain 自己的燃料费；24 小时累计不超过预存金额。
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
