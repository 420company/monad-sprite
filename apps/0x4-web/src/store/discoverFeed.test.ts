// @vitest-environment jsdom
// 发现页榜单 store：同一份榜单不并发重复拉、30 秒内不重拉、失败保留旧列表、成功写本地快照。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketToken } from '@/lib/types'
import type { FeedPart } from '@/lib/marketFeed'

const calls: string[] = []
let impl: (kind: string) => Promise<FeedPart>[] = () => []
vi.mock('@/lib/market', () => ({
  feedSources: (kind: string) => { calls.push(kind); return impl(kind) },
  getChainPools: async (kind: string, key: string) => { calls.push(`pools:${kind}:${key}`); return [] },
  // store/market 用到的，这里用不上
  getTokens: async () => [], getTrending: async () => [], searchTokens: async () => [], marketKey: (c: string, a: string) => `${c}:${a.toLowerCase()}`, SOL_MINT: 'sol',
}))

const tk = (chain: string, address: string): MarketToken => ({ chain, chainId: 1, address, symbol: address, name: address, logo: '', priceUsd: 1, liquidityUsd: 10_000, volume24h: 1 })

describe('发现页榜单 store', () => {
  beforeEach(() => { localStorage.clear(); calls.length = 0; vi.resetModules() })

  it('并发只拉一次；拉完 30 秒内再要不发请求；数据写进本地快照', async () => {
    impl = () => [Promise.resolve({ list: [tk('robinhood', 'r1'), tk('bsc', 'b1')], pending: [] })]
    const { useDiscoverFeed } = await import('./discoverFeed')
    const s = useDiscoverFeed.getState()
    await Promise.all([s.load('market'), s.load('market')])
    expect(calls).toEqual(['market'])
    await s.load('market')
    expect(calls).toEqual(['market'])
    const feed = useDiscoverFeed.getState().feeds.market
    expect(feed.list.map((x) => x.address).sort()).toEqual(['b1', 'r1'])
    expect(feed.loading).toBe(false)
    expect(JSON.parse(localStorage.getItem('0x4.discover.v1.market')!).list).toHaveLength(2)
    await s.load('market', true)   // 用户点刷新：强制重拉
    expect(calls).toEqual(['market', 'market'])
  })

  it('App 重开：先拿本地快照显示，再刷新', async () => {
    localStorage.setItem('0x4.discover.v1.hot', JSON.stringify({ at: Date.now() - 60_000, list: [tk('bsc', 'old')] }))
    impl = () => [Promise.resolve({ list: [tk('bsc', 'new')] })]
    const { useDiscoverFeed } = await import('./discoverFeed')
    expect(useDiscoverFeed.getState().feeds.hot.list.map((x) => x.address)).toEqual(['old'])
    await useDiscoverFeed.getState().load('hot')
    expect(useDiscoverFeed.getState().feeds.hot.list.map((x) => x.address)).toEqual(['new'])
    expect(useDiscoverFeed.getState().feeds.hot.fromSnapshot).toBe(false)
  })

  it('全部失败：旧列表留着，只标记失败；下次立刻重拉', async () => {
    localStorage.setItem('0x4.discover.v1.new', JSON.stringify({ at: Date.now() - 60_000, list: [tk('bsc', 'keep')] }))
    impl = () => [Promise.reject(new Error('down'))]
    const { useDiscoverFeed } = await import('./discoverFeed')
    await useDiscoverFeed.getState().load('new')
    const f = useDiscoverFeed.getState().feeds.new
    expect(f.list.map((x) => x.address)).toEqual(['keep'])
    expect(f.error).toBe(true)
    await useDiscoverFeed.getState().load('new')
    expect(calls).toEqual(['new', 'new'])
  })

  it('「更多」里的链按链分开存', async () => {
    const { useDiscoverFeed, poolsFeedName } = await import('./discoverFeed')
    await useDiscoverFeed.getState().loadPools('trending', 'monad')
    expect(calls).toEqual(['pools:trending:monad'])
    expect(useDiscoverFeed.getState().feeds[poolsFeedName('trending', 'monad')].at).toBeGreaterThan(0)
  })
})
