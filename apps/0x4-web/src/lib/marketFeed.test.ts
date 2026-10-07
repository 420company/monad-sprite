// @vitest-environment jsdom
// 发现页榜单：数据源陆续回来的合并、切链状态（正在读取中 / 读取失败 / 暂无行情）、本地快照。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketToken } from './types'
import {
  EMPTY_FEED, SNAPSHOT_MAX_AGE, SNAPSHOT_MAX_ITEMS, feedFailed, feedFromSnapshot, feedLoading, filterChain, finalizeFeed,
  isFresh, listState, mergeParts, readSnapshot, runFeed, writeSnapshot, type Feed, type FeedPart, type FeedProgress,
} from './marketFeed'

const tk = (chain: string, address: string, extra: Partial<MarketToken> = {}): MarketToken =>
  ({ chain, chainId: 1, address, symbol: address, name: address, logo: '', priceUsd: 1, liquidityUsd: 10_000, ...extra })

/** 手动控制什么时候回来的数据源 */
function deferred() {
  let resolve!: (v: FeedPart) => void, reject!: (e: Error) => void
  const promise = new Promise<FeedPart>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const addrs = (l: MarketToken[]) => l.map((x) => x.address)

describe('runFeed：谁先回来先显示', () => {
  it('快的源先交出去，不等慢的；最后按源的顺序合并去重', async () => {
    const slow = deferred(), fast = deferred()
    const updates: FeedProgress[] = []
    const done = runFeed((l) => l, [slow.promise, fast.promise], (p) => updates.push(p))
    fast.resolve({ list: [tk('robinhood', 'r1'), tk('solana', 'dup', { priceUsd: 2 })], pending: [] })
    await flush()
    expect(updates).toHaveLength(1)
    expect(updates[0].done).toBe(false)
    expect(addrs(updates[0].list)).toEqual(['r1', 'dup'])   // 慢的还没回来，已经能显示
    slow.resolve({ list: [tk('solana', 'DUP', { priceUsd: 9 }), tk('solana', 's1')] })
    const final = await done
    expect(final.done).toBe(true)
    // 排在前面的源优先：dup 用慢源（第 0 个）给的那条
    expect(addrs(final.list)).toEqual(['DUP', 's1', 'r1'])
    expect(final.list[0].priceUsd).toBe(9)
    expect(final.failed).toBe(false)
  })

  it('旧列表先垫着：新数据同一个币盖掉旧的，全部回来后旧的丢掉', async () => {
    const a = deferred(), b = deferred()
    const updates: FeedProgress[] = []
    const old = [tk('bsc', 'x', { priceUsd: 1 }), tk('bsc', 'gone')]
    const done = runFeed((l) => l, [a.promise, b.promise], (p) => updates.push(p), old)
    a.resolve({ list: [tk('bsc', 'x', { priceUsd: 5 })] })
    await flush()
    expect(addrs(updates[0].list)).toEqual(['x', 'gone'])
    expect(updates[0].list[0].priceUsd).toBe(5)
    b.resolve({ list: [tk('bsc', 'y')] })
    expect(addrs((await done).list)).toEqual(['x', 'y'])
  })

  it('服务器说还在读的链汇总成 pending；部分失败记 partialFailed，全部失败记 failed', async () => {
    const one = await runFeed((l) => l, [Promise.resolve({ list: [], pending: ['robinhood', 'arc'] }), Promise.reject(new Error('x'))], () => {})
    expect(one.pending).toEqual(['robinhood', 'arc'])
    expect(one.partialFailed).toBe(true)
    expect(one.failed).toBe(false)
    const all = await runFeed((l) => l, [Promise.reject(new Error('a')), Promise.reject(new Error('b'))], () => {})
    expect(all.failed).toBe(true)
    expect(all.list).toEqual([])
  })

  it('mergeParts 大小写不同的地址算同一个币', () => {
    expect(addrs(mergeParts([{ list: [tk('bsc', '0xAB')] }, undefined, { list: [tk('bsc', '0xab'), tk('base', '0xab')] }]))).toEqual(['0xAB', '0xab'])
  })
})

describe('finalizeFeed：各榜单的过滤与排序', () => {
  const list = [
    tk('bsc', 'thin', { liquidityUsd: 100, volume24h: 1e9 }),
    tk('bsc', 'a', { volume24h: 10, change1h: -50, createdAt: 1 }),
    tk('bsc', 'b', { volume24h: 30, change1h: 5, createdAt: 3 }),
  ]
  it('市场按成交额、火热按 1 小时涨跌幅度、最新按上线时间，流动性不足 $5k 的丢掉', () => {
    expect(addrs(finalizeFeed('market', [...list]))).toEqual(['b', 'a'])
    expect(addrs(finalizeFeed('hot', [...list]))).toEqual(['a', 'b'])
    expect(addrs(finalizeFeed('new', [...list]))).toEqual(['b', 'a'])
  })
  it('股票原样', () => { expect(addrs(finalizeFeed('stocks', list))).toEqual(['thin', 'a', 'b']) })
})

describe('切链：本地过滤 + 列表状态', () => {
  const feed: Feed = { ...EMPTY_FEED, at: 1, list: [tk('bsc', 'b1'), tk('robinhood', 'r1'), tk('bsc', 'b2')] }

  it('按链过滤不发请求；all 原样', () => {
    expect(addrs(filterChain(feed.list, 'bsc'))).toEqual(['b1', 'b2'])
    expect(addrs(filterChain(feed.list, 'robinhood'))).toEqual(['r1'])
    expect(filterChain(feed.list, 'all')).toBe(feed.list)
  })

  it('有数据就显示列表，哪怕还在刷新', () => {
    expect(listState({ count: 3, loading: true, error: true })).toBe('list')
  })

  it('从没拿到过 → 正在读取中，不是暂无行情', () => {
    expect(feedLoading(EMPTY_FEED, 'robinhood')).toBe(true)
    expect(listState({ count: 0, loading: feedLoading(EMPTY_FEED, 'robinhood'), error: feedFailed(EMPTY_FEED, 'robinhood') })).toBe('loading')
  })

  it('服务器说这条链首轮还没拉完 → 正在读取中；别的链不受影响', () => {
    const cold: Feed = { ...feed, pending: ['robinhood'] }
    expect(feedLoading(cold, 'robinhood')).toBe(true)
    expect(feedLoading(cold, 'arc')).toBe(false)
    expect(listState({ count: 0, loading: feedLoading(cold, 'arc'), error: feedFailed(cold, 'arc') })).toBe('empty')
  })

  it('已经拿到过、只是后台刷新：真没数据的链显示暂无行情，不来回闪', () => {
    const refreshing: Feed = { ...feed, loading: true }
    expect(feedLoading(refreshing, 'arc')).toBe(false)
  })

  it('失败 → 读取失败；点重试后重拉期间 → 正在读取中', () => {
    const failed: Feed = { ...EMPTY_FEED, error: true }
    expect(listState({ count: 0, loading: feedLoading(failed, 'bsc'), error: feedFailed(failed, 'bsc') })).toBe('error')
    const retrying: Feed = { ...failed, loading: true }
    expect(listState({ count: 0, loading: feedLoading(retrying, 'bsc'), error: feedFailed(retrying, 'bsc') })).toBe('loading')
  })

  it('部分数据源失败：按链筛后为空算读取失败，全部视图不算', () => {
    const partial: Feed = { ...feed, partialError: true }
    expect(feedFailed(partial, 'arc')).toBe(true)
    expect(feedFailed(partial, 'all')).toBe(false)
  })
})

describe('本地快照', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('存了下次打开先拿出来；描述不存；超过条数截断', () => {
    const many = Array.from({ length: SNAPSHOT_MAX_ITEMS + 5 }, (_, i) => tk('bsc', `a${i}`, { description: '很长的介绍' }))
    writeSnapshot('market', many, 1_000)
    const s = readSnapshot('market', 2_000)!
    expect(s.at).toBe(1_000)
    expect(s.list).toHaveLength(SNAPSHOT_MAX_ITEMS)
    expect(s.list[0].description).toBeUndefined()
    expect(localStorage.getItem('0x4.discover.v1.market')).toBeTruthy()
    const f = feedFromSnapshot('market', 2_000)
    expect(f.at).toBe(1_000)
    expect(f.loading).toBe(false)
    expect(f.fromSnapshot).toBe(true)
    // 有快照直接显示列表；快照里没有的链在刷新回来前算正在读取中（快照只存了前几百条），不是暂无行情
    expect(listState({ count: filterChain(f.list, 'bsc').length, loading: feedLoading(f, 'bsc'), error: false })).toBe('list')
    expect(listState({ count: filterChain(f.list, 'robinhood').length, loading: feedLoading(f, 'robinhood'), error: feedFailed(f, 'robinhood') })).toBe('loading')
    expect(isFresh(f, 2_000)).toBe(false)   // 快照一定要刷新一次
  })

  it('太旧的快照不拿出来', () => {
    writeSnapshot('hot', [tk('bsc', 'x')], 1_000)
    expect(readSnapshot('hot', 1_000 + SNAPSHOT_MAX_AGE + 1)).toBeNull()
    expect(feedFromSnapshot('hot', 1_000 + SNAPSHOT_MAX_AGE + 1)).toBe(EMPTY_FEED)
  })

  it('写坏的内容、存储不可用都不抛错', () => {
    localStorage.setItem('0x4.discover.v1.new', '{坏的')
    expect(readSnapshot('new')).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => writeSnapshot('new', [tk('bsc', 'x')])).not.toThrow()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(readSnapshot('new')).toBeNull()
  })
})

describe('isFresh：多久内不重复拉', () => {
  it('30 秒内不重拉；服务器还有链在读时 4 秒；失败过或从没拿到过立刻拉', () => {
    const f: Feed = { ...EMPTY_FEED, at: 100_000, list: [tk('bsc', 'x')] }
    expect(isFresh(f, 129_000)).toBe(true)
    expect(isFresh(f, 131_000)).toBe(false)
    expect(isFresh({ ...f, pending: ['arc'] }, 103_000)).toBe(true)
    expect(isFresh({ ...f, pending: ['arc'] }, 105_000)).toBe(false)
    expect(isFresh({ ...f, error: true }, 100_001)).toBe(false)
    expect(isFresh(EMPTY_FEED, 1)).toBe(false)
  })
})
