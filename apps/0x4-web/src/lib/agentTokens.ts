// Zalien agent token lookup (added 2026-10-07 for hackathon).
// Resolves a ticker or 0x address typed in the agent chat to a MemeLauncher token on Monad testnet.
// All reads go through monadLauncher.ts; the launcher token list is cached briefly to keep the chat snappy.
import { getLauncherToken, listLauncherTokens, type LauncherToken } from './monadLauncher'
import type { TokenRef } from './agentIntent'

const CACHE_MS = 60_000
let cache: { at: number; tokens: LauncherToken[] } | null = null

/** All launcher tokens (first 50 by creation order, see listLauncherTokens), cached for a minute */
async function launcherTokens(force = false): Promise<LauncherToken[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.tokens
  const addresses = await listLauncherTokens()
  const infos = await Promise.all(addresses.map((a) => getLauncherToken(a)))
  const tokens = infos.filter((x): x is LauncherToken => x !== null)
  cache = { at: Date.now(), tokens }
  return tokens
}

export type TokenLookup =
  | { ok: true; token: LauncherToken; /** other launcher tokens sharing the same ticker */ duplicates: number }
  | { ok: false; error: string }

/** Find the launcher token a chat reference points to */
export async function resolveLauncherToken(ref: TokenRef): Promise<TokenLookup> {
  if (ref.kind === 'address') {
    const token = await getLauncherToken(ref.address)
    return token
      ? { ok: true, token, duplicates: 0 }
      : { ok: false, error: `${ref.address} is not a MemeLauncher token on Monad testnet.` }
  }
  const find = (list: LauncherToken[]) => list.filter((x) => x.symbol.toUpperCase() === ref.symbol)
  let matches = find(await launcherTokens())
  // A token launched in the last minute may not be in the cache yet: refresh once before giving up
  if (!matches.length) matches = find(await launcherTokens(true))
  if (!matches.length) {
    return { ok: false, error: `No MemeLauncher token with ticker ${ref.symbol} on Monad testnet. Paste its 0x address, or launch one on the Launch page.` }
  }
  // Tickers are not unique on the launcher: pick the most recently created one and tell the user
  return { ok: true, token: matches[matches.length - 1], duplicates: matches.length - 1 }
}
