// @vitest-environment jsdom
// 币种 K 线秒开（2026-09-29）：本机记住看过的、同一交易对请求合并、预取有额度、限流后一分钟不预取
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDexCandles, peekDexCandles, prefetchDexCandles, resetCandleCache, resetServerCandleChannel } from './candles'
import { resetCandleConfig } from './candleConfig'

const input = { chain: 'solana', address: 'Tok111', pairAddress: 'Pair111', interval: '1h' as const }
const row = (t: number) => [t, 1, 2, 0.5, 1.5, 100]
const okBody = (n = 3) => ({ data: { attributes: { ohlcv_list: Array.from({ length: n }, (_, i) => row(1_790_000_000 + i * 3600)) } }, meta: { base: { address: 'Tok111' }, quote: { address: 'So111' } } })
let calls = 0
let status = 200
let gate: Promise<void> | null = null
// 服务器通道（/api/candles）单独记，calls 只数 GeckoTerminal
let serverUrls: string[] = []

/** 这个文件测的是「浏览器直连 GeckoTerminal」那条路的限流 / 预取逻辑：固定成完整历史只走直连（2026-09-30 起默认先问服务器，另有测试） */
const DIRECT_ONLY = JSON.stringify({ v: 1, app: { fast: ['server', 'dexpaprika'], full: ['geckoterminal'] }, server: { ready: true } })

beforeEach(() => {
  resetCandleCache(); resetServerCandleChannel(); resetCandleConfig(); localStorage.clear(); localStorage.setItem('0x4.candleConfig.v1', DIRECT_ONLY); calls = 0; status = 200; gate = null; serverUrls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/candles')) { serverUrls.push(String(url)); return new Response(JSON.stringify({ enabled: true, candles: [] }), { status: 200 }) }
    calls++
    if (gate) await gate
    return new Response(status === 200 ? JSON.stringify(okBody()) : '{}', { status })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('K 线秒开', () => {
  it('看过的 K 线存在本机：内存清空（App 重开）后先拿到旧图，再加载时照样去拿最新的', async () => {
    const first = await loadDexCandles(input)
    expect(first.candles).toHaveLength(3)
    resetCandleCache()
    const known = peekDexCandles(input)
    expect(known?.candles).toHaveLength(3)
    // 旧图的时间照原来的算：一分钟以上的会重新拉
    const stored = JSON.parse(localStorage.getItem('0x4.candles.v1')!)
    for (const k of Object.keys(stored)) stored[k].at -= 120_000
    localStorage.setItem('0x4.candles.v1', JSON.stringify(stored))
    resetCandleCache()
    peekDexCandles(input)
    await loadDexCandles(input)
    expect(calls).toBe(2)
  })

  it('同一交易对同一周期正在请求时，页面打开直接接上预取那一次，只发一个请求', async () => {
    let open!: () => void
    gate = new Promise((r) => { open = r })
    prefetchDexCandles(input)
    const page = loadDexCandles(input)
    open()
    expect((await page).candles).toHaveLength(3)
    expect(calls).toBe(1)
  })

  it('预取每分钟有额度，不会把 GeckoTerminal 的免费次数用光', async () => {
    for (let i = 0; i < 25; i++) prefetchDexCandles({ ...input, pairAddress: `Pair${i}` })
    await vi.waitFor(() => expect(calls).toBe(10))
    // 用户自己点开的请求不受预取额度限制
    await loadDexCandles({ ...input, pairAddress: 'PairUser' })
    expect(calls).toBe(11)
  })

  it('碰到限流（429）后一分钟内不预取，用户点开的照常去拿', async () => {
    status = 429
    await expect(loadDexCandles(input)).rejects.toThrow()
    status = 200
    prefetchDexCandles({ ...input, pairAddress: 'Other' })
    expect(calls).toBe(1)
    await loadDexCandles({ ...input, pairAddress: 'Other' })
    expect(calls).toBe(2)
  })

  it('本机存储不可用（无痕模式）也照常加载', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    const got = await loadDexCandles(input)
    expect(got.candles).toHaveLength(3)
    spy.mockRestore()
  })

  it('本机存的内容坏了就当没有', () => {
    localStorage.setItem('0x4.candles.v1', '{"x":{"at":"bad"}}')
    expect(peekDexCandles(input)).toBeNull()
  })
})

describe('列表行按下预取', () => {
  it('按下不动 → 预取；按下后开始滑动 → 不预取；按下马上抬起 → 立刻预取', async () => {
    vi.useFakeTimers()
    const { pressPrefetchHandlers } = await import('./candlePrefetch')
    const { useMarket } = await import('@/store/market')
    useMarket.setState({ cache: { 'solana:tok111': { pairAddress: 'Pair111' } } } as never)
    const h = pressPrefetchHandlers({ chain: 'solana', address: 'Tok111' })
    h.onPointerDown({ clientX: 10, clientY: 10 }); h.onPointerMove({ clientX: 10, clientY: 40 })
    vi.advanceTimersByTime(200)
    expect(calls).toBe(0)
    h.onPointerDown({ clientX: 10, clientY: 10 }); vi.advanceTimersByTime(100)
    expect(calls).toBe(1)
    resetCandleCache(); localStorage.clear()
    const h2 = pressPrefetchHandlers({ chain: 'solana', address: 'Tok111' })
    h2.onPointerDown({ clientX: 0, clientY: 0 }); h2.onPointerUp()
    expect(calls).toBe(2)
    // 同时向服务器通道预取，只读缓存（prefetch=1）
    expect(serverUrls.length).toBeGreaterThan(0)
    expect(serverUrls.every((u) => u.includes('prefetch=1'))).toBe(true)
    vi.useRealTimers()
  })
})

describe('首屏快速 K 线（DexPaprika）', () => {
  it('1 小时周期：解析最近 24 根，按时间排好；其他周期、不支持的链直接不问', async () => {
    const { loadQuickCandles } = await import('./candles')
    const rows = [
      { time_open: '2026-09-29T01:00:00Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time_open: '2026-09-29T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.2, volume: 9 },
      { time_open: 'bad', open: 1, high: 2, low: 0.5, close: 1.2, volume: 9 },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return new Response(JSON.stringify(rows), { status: 200 }) }))
    const q = await loadQuickCandles(input)
    expect(q?.source).toBe('DexPaprika')
    expect(q?.candles.map((c) => c.close)).toEqual([1.2, 1.5])
    expect(await loadQuickCandles({ ...input, interval: '15m' })).toBeNull()
    expect(await loadQuickCandles({ ...input, chain: 'unknownchain' })).toBeNull()
    expect(calls).toBe(1)
  })
  it('拿不到（403 / 超时 / 网络错）返回 null，不抛错', async () => {
    const { loadQuickCandles } = await import('./candles')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    expect(await loadQuickCandles(input)).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await loadQuickCandles(input)).toBeNull()
  })
})

describe('服务器 K 线通道（DexPaprika 带密钥）', () => {
  const serverCandles = [{ time: 1_790_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }, { time: 1_789_999_100, open: 1, high: 2, low: 0.5, close: 1.2, volume: 1 }, { time: 5, open: 1, high: 0.1, low: 0.5, close: 1, volume: 1 }]
  const route = (server: () => Response) => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/api/candles')) return server()
      if (url.includes('api.dexpaprika.com')) return new Response(JSON.stringify([{ time_open: '2026-09-29T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.1, volume: 1 }]), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
    return seen
  }
  beforeEach(async () => { (await import('./candles')).resetServerCandleChannel() })

  it('服务器开通时各周期都先用服务器的（带 token，过滤坏数据、升序），不再直连', async () => {
    const { loadFastCandles } = await import('./candles')
    const seen = route(() => new Response(JSON.stringify({ enabled: true, source: 'DexPaprika', candles: serverCandles }), { status: 200 }))
    for (const interval of ['15m', '1h', '4h', '1d'] as const) {
      const r = await loadFastCandles({ ...input, interval })
      expect(r?.source).toBe('DexPaprika')
      expect(r?.candles.map((c) => c.close)).toEqual([1.2, 1.5])
    }
    expect(seen.every((u) => u.includes('/api/candles'))).toBe(true)
    expect(seen[0]).toContain(`token=${input.address}`)
  })
  it('服务器没开通（enabled:false）：退回免密钥 1 小时直连，5 分钟内不再问服务器；其他周期没有快速图', async () => {
    const { loadFastCandles } = await import('./candles')
    const seen = route(() => new Response(JSON.stringify({ enabled: false }), { status: 200 }))
    expect((await loadFastCandles(input))?.candles).toHaveLength(1)
    expect(await loadFastCandles({ ...input, interval: '15m' })).toBeNull()
    await loadFastCandles(input)
    expect(seen.filter((u) => u.includes('/api/candles'))).toHaveLength(1)
  })
  it('服务器出错 / 断网：这一次退回直连，下一次照常再问服务器', async () => {
    const { loadFastCandles } = await import('./candles')
    const seen = route(() => { throw new Error('offline') })
    expect((await loadFastCandles(input))?.source).toBe('DexPaprika')
    await loadFastCandles(input)
    expect(seen.filter((u) => u.includes('/api/candles'))).toHaveLength(2)
  })

  it('预取带 prefetch=1（服务器只读缓存）；拿到了点开币种页直接用，不再问服务器', async () => {
    const { prefetchServerCandles, loadFastCandles } = await import('./candles')
    const seen = route(() => new Response(JSON.stringify({ enabled: true, source: 'DexPaprika', candles: serverCandles }), { status: 200 }))
    prefetchServerCandles(input)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toContain('prefetch=1')
    const r = await loadFastCandles(input)
    expect(r?.candles.map((c) => c.close)).toEqual([1.2, 1.5])
    expect(seen).toHaveLength(1)
  })
  it('预取没拿到（服务器缓存里没有）：点开时正式请求一次，不带 prefetch', async () => {
    const { prefetchServerCandles, loadFastCandles } = await import('./candles')
    let n = 0
    const seen = route(() => new Response(JSON.stringify(n++ === 0 ? { enabled: true, candles: [] } : { enabled: true, candles: serverCandles }), { status: 200 }))
    prefetchServerCandles(input)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect((await loadFastCandles(input))?.candles).toHaveLength(2)
    expect(seen).toHaveLength(2)
    expect(seen[1]).not.toContain('prefetch')
  })
  it('预取还在路上时点开：等它，不重复问服务器', async () => {
    const { prefetchServerCandles, loadFastCandles } = await import('./candles')
    let open!: () => void
    const wait = new Promise<void>((r) => { open = r })
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen.push(url); await wait; return new Response(JSON.stringify({ enabled: true, candles: serverCandles }), { status: 200 }) }))
    prefetchServerCandles(input)
    const page = loadFastCandles(input)
    open()
    expect((await page)?.candles).toHaveLength(2)
    expect(seen).toHaveLength(1)
  })
  it('服务器被限速（limited:true）：退回免密钥 1 小时直连，下次照常问服务器', async () => {
    const { loadFastCandles } = await import('./candles')
    const seen = route(() => new Response(JSON.stringify({ enabled: true, candles: [], limited: true }), { status: 200 }))
    expect((await loadFastCandles(input))?.candles.map((c) => c.close)).toEqual([1.1])
    await loadFastCandles(input)
    expect(seen.filter((u) => u.includes('/api/candles'))).toHaveLength(2)
    expect(seen.filter((u) => u.includes('api.dexpaprika.com'))).toHaveLength(2)
  })
  it('服务器预取每分钟最多 20 次，不挤占按 IP 的额度', async () => {
    const { prefetchServerCandles } = await import('./candles')
    const seen = route(() => new Response(JSON.stringify({ enabled: true, candles: [] }), { status: 200 }))
    for (let i = 0; i < 30; i++) prefetchServerCandles({ ...input, pairAddress: `Pair${i}` })
    await vi.waitFor(() => expect(seen).toHaveLength(20))
  })
})

// 2026-09-29 goat：网页版现货页 BTCB「K 线加载失败 / 暂无历史 K 线」。GeckoTerminal 按 IP 限流时回的 429 不带跨域头，
// 浏览器里 fetch 直接抛「Failed to fetch」，看不到 429；以前原样抛出、预取接着打它，完整历史一直失败，也不会去问我们的服务器
describe('GeckoTerminal 限流（浏览器里看不到 429）', () => {
  const serverCandles = [{ time: 1_790_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }, { time: 1_790_003_600, open: 1.5, high: 2, low: 1, close: 1.8, volume: 1 }]
  it('直连抛 Failed to fetch：当限流，完整历史改问我们的服务器拿到数据；一分钟内预取不再打它', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/api/candles')) return new Response(JSON.stringify({ enabled: true, source: 'DexPaprika', candles: serverCandles }), { status: 200 })
      throw new TypeError('Failed to fetch')
    }))
    const r = await loadDexCandles(input)
    expect(r.candles.map((c) => c.close)).toEqual([1.5, 1.8])
    expect(seen.filter((u) => u.includes('geckoterminal'))).toHaveLength(1)
    expect(seen.filter((u) => u.includes('/api/candles'))).toHaveLength(1)
    // 预取不打它
    prefetchDexCandles({ ...input, pairAddress: 'Pair222' })
    expect(seen.filter((u) => u.includes('geckoterminal'))).toHaveLength(1)
    // 用户换个周期：照常直连试一次，失败照样从服务器拿到
    const again = await loadDexCandles({ ...input, interval: '4h' })
    expect(again.candles).toHaveLength(2)
  })
  it('服务器也拿不到（没开通）：照旧报错让页面显示重试（不画假数据）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/candles')) return new Response(JSON.stringify({ enabled: false }), { status: 200 })
      throw new TypeError('Failed to fetch')
    }))
    await expect(loadDexCandles(input)).rejects.toThrow()
  })
  it('阳性对照：完整历史设成只走直连时，GeckoTerminal 正常就不去问服务器', async () => {
    const r = await loadDexCandles(input)
    expect(r.candles).toHaveLength(3)
    expect(serverUrls).toHaveLength(0)
  })
})
