// Pure logic for the Discover lists (2026-09-26: boss reported slow chain switching and "no market data" shown while loading).
// No requests here, no React — only: how to merge as sources arrive one by one, how local snapshots are stored/read, and whether a chain should currently show list / loading / failed / no-data.
// Requests live in lib/market.ts's feedSources, state in store/discoverFeed.ts.
import type { MarketToken } from './types'

export type FeedKind = 'market' | 'hot' | 'new' | 'stocks'

/** One result from one source. pending = chains the server says haven't finished their first round (DexScreener chain ids); only our server's lists carry it */
export interface FeedPart { list: MarketToken[]; pending?: string[] }

/** One list's on-page state */
export interface Feed {
  list: MarketToken[]
  /** Last time data was received; 0 = never */
  at: number
  /** Chains the server is still reading */
  pending: string[]
  /** Loading (not all sources are back) */
  loading: boolean
  /** Last time, all sources failed */
  error: boolean
  /** Last time some source failed (empty after chain filtering counts as failed, not as no-data) */
  partialError: boolean
  /** The list comes from a snapshot saved at last app open and hasn't refreshed successfully this time (snapshots only keep the first few hundred entries — an empty chain doesn't mean truly empty) */
  fromSnapshot?: boolean
}

export const EMPTY_FEED: Feed = { list: [], at: 0, pending: [], loading: false, error: false, partialError: false }

const key = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`
const MIN_LIQUIDITY = 5000

/** Finishing for each list: market / hot / new keep only liquidity ≥ $5k, then sort by their own rules; stocks arrive pre-sorted */
export function finalizeFeed(kind: FeedKind, list: MarketToken[]): MarketToken[] {
  if (kind === 'stocks') return list
  const liquid = list.filter((tk) => (tk.liquidityUsd || 0) >= MIN_LIQUIDITY)
  if (kind === 'hot') return liquid.sort((a, b) => Math.abs(b.change1h ?? 0) - Math.abs(a.change1h ?? 0))
  if (kind === 'new') return liquid.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return liquid.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
}

/** Merge in the sources' fixed order (not arrival order); same chain + same coin keeps only the entry from the earlier source */
export function mergeParts(parts: (FeedPart | undefined)[]): MarketToken[] {
  const seen = new Set<string>()
  const out: MarketToken[] = []
  for (const p of parts) {
    if (!p) continue
    for (const tk of p.list) {
      const k = key(tk.chain, tk.address)
      if (seen.has(k)) continue
      seen.add(k); out.push(tk)
    }
  }
  return out
}

export interface FeedProgress { list: MarketToken[]; pending: string[]; done: boolean; failed: boolean; partialFailed: boolean }

/**
 * Sources run in parallel; as each returns, merge what's here and hand it out — don't wait for the slowest.
 * mergeSources used to wait for all (DexScreener per-chain backfill + Jupiter take 2–4s), so even our server's list arriving in 0.4s had to wait along.
 *
 * finalize = filter + sort (per-list rules in finalizeFeed).
 * previous = the old list currently on screen: before all sources are back, new data is layered over the old (same coin takes the new entry) so it doesn't flash; once all are back, the old is dropped.
 */
export function runFeed(finalize: (list: MarketToken[]) => MarketToken[], sources: Promise<FeedPart>[], onUpdate: (p: FeedProgress) => void, previous: MarketToken[] = []): Promise<FeedProgress> {
  const parts: (FeedPart | undefined)[] = sources.map(() => undefined)
  let settled = 0
  let failures = 0
  return new Promise((resolve) => {
    if (!sources.length) { const p = { list: [], pending: [], done: true, failed: false, partialFailed: false }; onUpdate(p); resolve(p); return }
    const emit = () => {
      const done = settled === sources.length
      const pending = [...new Set(parts.flatMap((p) => p?.pending ?? []))]
      const merged = mergeParts(done ? parts : [...parts, { list: previous }])
      const p: FeedProgress = { list: finalize(merged), pending, done, failed: done && failures === sources.length, partialFailed: failures > 0 }
      onUpdate(p)
      if (done) resolve(p)
    }
    sources.forEach((src, i) => {
      src.then((part) => { parts[i] = part }, () => { failures++ })
        .finally(() => { settled++; emit() })
    })
  })
}

/** Filter by chain: all = all */
export const filterChain = (list: MarketToken[], chain: string) => (chain === 'all' ? list : list.filter((tk) => tk.chain === chain))

/** What the list area should show: show the list when there's data; without data decide in the order "still reading → failed → truly none" */
export type ListState = 'list' | 'loading' | 'error' | 'empty'
export function listState(o: { count: number; loading: boolean; error: boolean }): ListState {
  if (o.count > 0) return 'list'
  if (o.loading) return 'loading'
  if (o.error) return 'error'
  return 'empty'
}

/**
 * Whether a chain still counts as "reading" in this list (only matters when the list is empty):
 * never got data; last attempt failed and is retrying; or the server says this chain's first round isn't done.
 * Already got data and it's just the 30s background refresh — doesn't count (otherwise a truly empty chain would flicker between "loading" and "no market data").
 */
export function feedLoading(feed: Feed, chain: string): boolean {
  if (feed.at === 0 && !feed.error && !feed.partialError) return true
  if (feed.fromSnapshot) return true
  if (feed.loading && (feed.at === 0 || feed.error || feed.partialError)) return true
  return chain === 'all' ? feed.pending.length > 0 && !feed.list.length : feed.pending.includes(chain)
}

/** Whether empty-after-chain-filter counts as a read failure */
export function feedFailed(feed: Feed, chain: string): boolean {
  return chain === 'all' ? feed.error : feed.error || feed.partialError
}

// ── Local snapshot: app reopen shows last time's lists first, then quietly refreshes ──

const PREFIX = '0x4.discover.v1.'
/** Snapshots older than 6h are not used — stale prices mislead */
export const SNAPSHOT_MAX_AGE = 6 * 3600_000
/** Cap entries per list to save localStorage */
export const SNAPSHOT_MAX_ITEMS = 300

interface Snapshot { at: number; list: MarketToken[] }

export function readSnapshot(name: string, now = Date.now()): Snapshot | null {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (!raw) return null
    const s = JSON.parse(raw) as Snapshot
    if (!s || typeof s.at !== 'number' || !Array.isArray(s.list)) return null
    if (now - s.at > SNAPSHOT_MAX_AGE) return null
    return s
  } catch { return null }
}

export function writeSnapshot(name: string, list: MarketToken[], at = Date.now()): void {
  // Descriptions are long and unused — don't store them
  const slim = list.slice(0, SNAPSHOT_MAX_ITEMS).map(({ description: _d, ...tk }) => tk)
  try { localStorage.setItem(PREFIX + name, JSON.stringify({ at, list: slim })) } catch { /* If it can't be saved, re-pull next time — doesn't affect usage */ }
}

/** Snapshot → page initial state (no snapshot means never received) */
export function feedFromSnapshot(name: string, now = Date.now()): Feed {
  const s = readSnapshot(name, now)
  return s ? { ...EMPTY_FEED, list: s.list, at: s.at, fromSnapshot: true } : EMPTY_FEED
}

/** Don't re-pull within this interval: 4s checks while the server says some chain is still reading, 30s normally */
export function isFresh(feed: Feed, now = Date.now(), maxAge = 30_000): boolean {
  if (!feed.at || feed.error || feed.fromSnapshot) return false
  return now - feed.at < (feed.pending.length ? 4_000 : maxAge)
}
