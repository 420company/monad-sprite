// 发现页榜单状态（2026-09-26）：市场 / 火热 / 最新 / 股票 + 「更多」里各链的榜单，按名字存一份 Feed。
// · 内存里一直留着，切视图、切链、离开发现页再回来都直接拿现成的，不重拉不转圈
// · 同时存 localStorage（带时间），App 重开先显示上次的，再悄悄刷新
// · 同一份榜单同时只有一个请求在跑；30 秒内拉过的不重复拉（服务器说有链还在读时 4 秒一查）
import { create } from 'zustand'
import type { MarketToken } from '@/lib/types'
import { feedSources, getChainPools } from '@/lib/market'
import { EMPTY_FEED, feedFromSnapshot, finalizeFeed, isFresh, runFeed, writeSnapshot, type Feed, type FeedKind, type FeedPart } from '@/lib/marketFeed'
import { useMarket } from './market'

const KINDS: FeedKind[] = ['market', 'hot', 'new', 'stocks']
/** 「更多」里某条链某种榜单的名字 */
export const poolsFeedName = (kind: 'trending' | 'new', dexKey: string) => `pools:${kind}:${dexKey}`

interface DiscoverFeedState {
  feeds: Record<string, Feed>
  /** 拉一份榜单；force = 用户点了刷新 / 重试 */
  load: (kind: FeedKind, force?: boolean) => Promise<void>
  /** 「更多」里某条链的榜单（服务器按需拉，缓存 60 秒） */
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

  /** 跑一次：sources 陆续回来就陆续更新；全部失败时保留旧列表只标记失败 */
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
      useMarket.getState().put(final.list)   // 详情页等处直接用
      writeSnapshot(name, final.list, at)
    } finally {
      running.delete(name)
    }
  }

  return {
    feeds: Object.fromEntries(KINDS.map((k) => [k, feedFromSnapshot(k)]).filter(([, f]) => (f as Feed).at)),
    load: (kind, force = false) => run(kind, (l) => finalizeFeed(kind, l), () => feedSources(kind), force, kind === 'stocks' ? 60_000 : 30_000),
    loadPools: (kind, dexKey, force = false) => run(poolsFeedName(kind, dexKey), (l) => l /* getChainPools 已滤过 */,
      () => [getChainPools(kind, dexKey).then((list: MarketToken[]): FeedPart => ({ list }))], force, 60_000),
  }
})
