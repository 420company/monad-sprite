// Discover-page leaderboard state (2026-09-26): markets / hot / new / stocks + per-chain leaderboards under "more", one Feed stored per name.
// - Kept in memory: switching views/chains or leaving and returning to discover reuses it — no refetch, no spinner
// - Also persisted to localStorage (timestamped); app reopen shows the last copy first, then silently refreshes
// - One in-flight request per leaderboard; no refetch within 30s (poll every 4s while the server says a chain is still reading)
import { create } from 'zustand'
import type { MarketToken } from '@/lib/types'
import { feedSources, getChainPools } from '@/lib/market'
import { EMPTY_FEED, feedFromSnapshot, finalizeFeed, isFresh, runFeed, writeSnapshot, type Feed, type FeedKind, type FeedPart } from '@/lib/marketFeed'
import { useMarket } from './market'

const KINDS: FeedKind[] = ['market', 'hot', 'new', 'stocks']
/** Name of one chain's one leaderboard kind under "more" */
export const poolsFeedName = (kind: 'trending' | 'new', dexKey: string) => `pools:${kind}:${dexKey}`

interface DiscoverFeedState {
  feeds: Record<string, Feed>
  /** Fetch one leaderboard; force = user hit refresh / retry */
  load: (kind: FeedKind, force?: boolean) => Promise<void>
  /** One chain's leaderboard under "more" (server pulls on demand, cached 60s) */
  loadPools: (kind: 'trending' | 'new', dexKey: string, force?: boolean) => Promise<void>
}

const running = new Set<string>()

export const useDiscoverFeed = create<DiscoverFeedState>()((set, get) => {
  const patch = (name: string, p: Partial<Feed>) => set((s) => ({ feeds: { ...s.feeds, [name]: { ...(s.feeds[name] ?? EMPTY_FEED), ...p } } }))
  const feed = (name: string): Feed => {
    const f = get().feeds[name]
    if (f) return f
    const hydrated = feedFromSnapshot(name)
    if (hydrated.at) patch(name, hydrated)
    return hydrated
  }

  /** Run once: update as sources arrive; on total failure keep the old list, just flag it failed */
  async function run(name: string, finalize: (l: MarketToken[]) => MarketToken[], sources: () => Promise<FeedPart>[], force: boolean, maxAge = 30_000) {
    if (running.has(name)) return
    const cur = feed(name)
    if (!force && isFresh(cur, Date.now(), maxAge)) return
    running.add(name)
    patch(name, { loading: true })
    try {
      const final = await runFeed(finalize, sources(), (p) => {
        if (p.done) return
        if (p.list.length) patch(name, { list: p.list, pending: p.pending })
      }, cur.list)
      if (final.failed) { patch(name, { loading: false, error: true, partialError: true, fromSnapshot: false }); return }
      const at = Date.now()
      patch(name, { list: final.list, pending: final.pending, at, loading: false, error: false, partialError: final.partialFailed, fromSnapshot: false })
      useMarket.getState().put(final.list)   // Used directly by detail pages etc.
      writeSnapshot(name, final.list, at)
    } finally {
      running.delete(name)
    }
  }

  return {
    feeds: Object.fromEntries(KINDS.map((k) => [k, feedFromSnapshot(k)]).filter(([, f]) => (f as Feed).at)),
    load: (kind, force = false) => run(kind, (l) => finalizeFeed(kind, l), () => feedSources(kind), force, kind === 'stocks' ? 60_000 : 30_000),
    loadPools: (kind, dexKey, force = false) => run(poolsFeedName(kind, dexKey), (l) => l /* getChainPools already filtered */,
      () => [getChainPools(kind, dexKey).then((list: MarketToken[]): FeedPart => ({ list }))], force, 60_000),
  }
})
