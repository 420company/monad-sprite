// Gas page "watched chains" (2026-09-29 goat: the chain list was hardcoded to five — needs to support adding more chains we support that can pre-store gas)
//
// List = the five defaults (BNB Chain is the top-up source; the other four are chains the sprite frequents) + user-added ones.
// Addable chains are limited to ones measured to support "BNB on BNB Chain → this chain's gas token": scripts/check-fuel-chains.ts uses exactly the same
// Quoted against LI.FI; results in docs/fuel-chains-probe.json (2026-09-29: 32 of 36 candidates passed; Sei, Celo, Fantom, Zora have no route).
// Whitelist changes require re-running the script; src/lib/fuelChains.test.ts checks the whitelist against the measured results.
// User-added chains: the gas page display, balance scan (portfolio), and auto top-up (GasWatch) all read the same copy — no "added on the page but auto top-up ignores it".
import { SOLANA_CHAIN_ID } from './chains'

export const FUEL_SOURCE_CHAIN = 56
/** The five shown by default, not removable */
export const DEFAULT_FUEL_CHAINS: readonly number[] = [FUEL_SOURCE_CHAIN, SOLANA_CHAIN_ID, 8453, 4663, 1]

/** Chains measured to swap from BNB into gas tokens (excluding BNB Chain itself), 2026-09-29 scripts/check-fuel-chains.ts */
export const REFUEL_CHAIN_IDS: readonly number[] = [
  SOLANA_CHAIN_ID, 1, 8453, 42161, 137, 10, 4663, 999, 5042, 143, 4326, 9745, 747474, 747, 43114, 59144, 324,
  534352, 81457, 5000, 146, 80094, 130, 2741, 100, 57073, 1868, 480, 34443, 25, 204, 33139,
]

/** Chains the user may add: the whitelist minus the five defaults */
export const ADDABLE_FUEL_CHAINS: readonly number[] = REFUEL_CHAIN_IDS.filter((id) => !DEFAULT_FUEL_CHAINS.includes(id))

/** Sanitize the saved user-added list: keep only addable ones, dedupe, preserve added order */
export function cleanFuelChains(list: unknown): number[] {
  if (!Array.isArray(list)) return []
  const out: number[] = []
  for (const x of list) if (typeof x === 'number' && ADDABLE_FUEL_CHAINS.includes(x) && !out.includes(x)) out.push(x)
  return out
}

/** The full list shown on the gas page: the five defaults first, user-added ones appended in added order */
export function fuelWatchList(extra: readonly number[]): number[] {
  return [...DEFAULT_FUEL_CHAINS, ...cleanFuelChains(extra)]
}

/** Chain name display: strip suffixes like Mainnet / Network from viem chain names for a cleaner list */
export const fuelChainName = (name: string) => name.replace(/\s+(Mainnet|Network)$/i, '').replace(/^ZKsync Era$/, 'zkSync')

// ---- Runtime route state ----
// The whitelist is empirically measured, but bridges occasionally suspend routes: a chain whose quote fails is marked "temporarily untopable" for 10 minutes with the status shown inline, so users can't tap out a doomed transaction
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
/** For tests */
export function resetRouteState() { routeDown.clear() }
