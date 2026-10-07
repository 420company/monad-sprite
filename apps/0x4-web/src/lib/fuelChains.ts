// 燃料费页「关注的链」（2026-09-29 goat：链写死只有五条，要能添加更多我们支持、能预存燃料费的链）
//
// 列表 = 默认五条（BNB Chain 是补充来源，另外四条是小精灵常去的链）+ 用户自己添加的。
// 能添加的链只限实测过「能从 BNB Chain 的 BNB 换到这条链的燃料费币」的：scripts/check-fuel-chains.ts 用和 App 补燃料费完全一样的
// 请求向 LI.FI 报价，结果在 docs/fuel-chains-probe.json（2026-09-29：36 条候选通过 32 条；Sei、Celo、Fantom、Zora 没有路线）。
// 白名单改动要重跑脚本，src/lib/fuelChains.test.ts 会核对白名单和实测结果一致。
// 用户添加的链：燃料费页显示、余额扫描（portfolio）、自动补充（GasWatch）三处读同一份，不会出现页面上加了自动补充却不管。
import { SOLANA_CHAIN_ID } from './chains'

export const FUEL_SOURCE_CHAIN = 56
/** 默认显示、不能移除的五条 */
export const DEFAULT_FUEL_CHAINS: readonly number[] = [FUEL_SOURCE_CHAIN, SOLANA_CHAIN_ID, 8453, 4663, 1]

/** 实测能从 BNB 换到燃料费币的链（不含 BNB Chain 本身），2026-09-29 scripts/check-fuel-chains.ts */
export const REFUEL_CHAIN_IDS: readonly number[] = [
  SOLANA_CHAIN_ID, 1, 8453, 42161, 137, 10, 4663, 999, 5042, 143, 4326, 9745, 747474, 747, 43114, 59144, 324,
  534352, 81457, 5000, 146, 80094, 130, 2741, 100, 57073, 1868, 480, 34443, 25, 204, 33139,
]

/** 用户可以添加的链：白名单里去掉默认五条 */
export const ADDABLE_FUEL_CHAINS: readonly number[] = REFUEL_CHAIN_IDS.filter((id) => !DEFAULT_FUEL_CHAINS.includes(id))

/** 存下来的用户添加列表清洗：只留能添加的、去重、保持添加顺序 */
export function cleanFuelChains(list: unknown): number[] {
  if (!Array.isArray(list)) return []
  const out: number[] = []
  for (const x of list) if (typeof x === 'number' && ADDABLE_FUEL_CHAINS.includes(x) && !out.includes(x)) out.push(x)
  return out
}

/** 燃料费页显示的完整列表：默认五条在前，用户添加的按添加顺序接在后面 */
export function fuelWatchList(extra: readonly number[]): number[] {
  return [...DEFAULT_FUEL_CHAINS, ...cleanFuelChains(extra)]
}

/** 链名显示：去掉 viem 链名里的 Mainnet / Network 之类后缀，列表更干净 */
export const fuelChainName = (name: string) => name.replace(/\s+(Mainnet|Network)$/i, '').replace(/^ZKsync Era$/, 'zkSync')

// ---- 运行时路线状态 ----
// 白名单是实测出来的，但桥偶尔会临时关路线：报价失败的链记 10 分钟「暂不可补」，行内显示状态，不再让用户点出一笔注定失败的交易
const ROUTE_DOWN_MS = 10 * 60_000
const routeDown = new Map<number, number>()
const listeners = new Set<() => void>()
export function markRouteDown(chainId: number, now = Date.now()) { routeDown.set(chainId, now + ROUTE_DOWN_MS); listeners.forEach((f) => f()) }
export function markRouteUp(chainId: number) { if (routeDown.delete(chainId)) listeners.forEach((f) => f()) }
export function isRouteDown(chainId: number, now = Date.now()): boolean {
  const until = routeDown.get(chainId)
  if (!until) return false
  if (until <= now) { routeDown.delete(chainId); return false }
  return true
}
export function onRouteChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
/** 测试用 */
export function resetRouteState() { routeDown.clear() }
