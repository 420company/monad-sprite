// @vitest-environment jsdom
// Candle-fetch settings (2026-09-29 goat: switching candle vendors must not require an app release): how server-pushed settings are normalized, stored on-device, and fall back to the last copy when unreachable;
// the app routes per settings: full history asks the server first or goes direct, the first-screen fast chart's route, prefetch follows settings, and the server isn't asked once it declares itself unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { candleConfig, refreshCandleConfig, resetCandleConfig, sanitizeCandleConfig, DEFAULT_CANDLE_CONFIG } from './candleConfig'
import { loadDexCandles, loadFastCandles, prefetchDexCandles, prefetchServerCandles, resetCandleCache, resetServerCandleChannel } from './candles'

const input = { chain: 'bsc', address: '0xTok', pairAddress: '0xPair', interval: '1h' as const }
const serverCandles = [{ time: 1_790_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }]
const geckoBody = { data: { attributes: { ohlcv_list: [[1_790_003_600, 1, 2, 0.5, 1.7, 1], [1_790_000_000, 1, 2, 0.5, 1.6, 1]] } }, meta: { base: { address: '0xTok' }, quote: { address: '0xUsdt' } } }
const conf = (app: { fast: string[]; full: string[] }, ready = true, v = 5) => ({ v, server: { order: ready ? ['geckoterminal'] : [], ready }, app })

let seen: string[] = []
let config: unknown = null
let server: () => Response = () => new Response(JSON.stringify({ enabled: true, source: 'GeckoTerminal', candles: serverCandles }), { status: 200 })
beforeEach(() => {
  resetCandleConfig(); resetCandleCache(); resetServerCandleChannel(); localStorage.clear(); seen = []; config = null
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    seen.push(url)
    if (url.includes('/api/candles/config')) return config ? new Response(JSON.stringify(config), { status: 200 }) : new Response('{}', { status: 500 })
    if (url.includes('/api/candles')) return server()
    if (url.includes('geckoterminal')) return new Response(JSON.stringify(geckoBody), { status: 200 })
    if (url.includes('dexpaprika')) return new Response(JSON.stringify([{ time_open: '2026-09-29T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.1, volume: 1 }]), { status: 200 })
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })
const use = async (c: unknown) => { config = c; await refreshCandleConfig(); seen = [] }

describe('设置怎么规整', () => {
  it('不认识的路、重复的去掉；完整历史为空或格式不对就不用（对照：正常的原样用）', () => {
    expect(sanitizeCandleConfig(conf({ fast: ['server', 'http://evil', 'server', 'dexpaprika'], full: ['geckoterminal'] }))).toEqual({ v: 5, fast: ['server', 'dexpaprika'], full: ['geckoterminal'], serverReady: true })
    expect(sanitizeCandleConfig(conf({ fast: [], full: [] }))).toBeNull()
    expect(sanitizeCandleConfig({ v: 1 })).toBeNull()
    expect(sanitizeCandleConfig(null)).toBeNull()
    expect(sanitizeCandleConfig(conf({ fast: [], full: ['server'] }, false))?.serverReady).toBe(false)
  })

  it('还没拉过：用内置默认（和以前的行为一样）；拉到了存本机，App 重开先用上次的；拉不到留着上次的', async () => {
    expect(candleConfig()).toEqual(DEFAULT_CANDLE_CONFIG)
    await use(conf({ fast: ['server'], full: ['server', 'geckoterminal'] }))
    expect(candleConfig().full).toEqual(['server', 'geckoterminal'])
    resetCandleConfig()   // Simulate app restart: memory gone, device copy remains
    expect(candleConfig().full).toEqual(['server', 'geckoterminal'])
    config = null   // The server errors this time
    await refreshCandleConfig()
    expect(candleConfig().v).toBe(5)
    expect(JSON.stringify(localStorage)).not.toMatch(/key|secret/i)
  })
})

describe('按设置选路', () => {
  it('完整历史先问服务器（2026-09-30 起的默认）：服务器拿到就不直连、请求带 full=1；服务器没拿到再直连', async () => {
    const d0 = await loadDexCandles(input)
    expect(d0.candles.length).toBeGreaterThan(0)
    expect(seen.some((u) => u.includes('/api/candles') && u.includes('full=1'))).toBe(true)
    expect(seen.some((u) => u.includes('geckoterminal'))).toBe(false)
    resetCandleCache()
    await use(conf({ fast: [], full: ['server', 'geckoterminal'] }))
    const d1 = await loadDexCandles({ ...input, pairAddress: '0xPair2' })
    expect(d1.candles.map((c) => c.close)).toEqual([1.5])
    expect(seen.some((u) => u.includes('geckoterminal'))).toBe(false)
    expect(seen[0]).not.toContain('prefetch')
    server = () => new Response(JSON.stringify({ enabled: true, candles: [], limited: true }), { status: 200 })
    seen = []
    const d2 = await loadDexCandles({ ...input, pairAddress: '0xPair3' })
    expect(d2.candles).toHaveLength(2)
    expect(seen.map((u) => (u.includes('/api/candles') ? 'server' : u.includes('geckoterminal') ? 'gecko' : 'other'))).toEqual(['server', 'gecko'])
    server = () => new Response(JSON.stringify({ enabled: true, source: 'GeckoTerminal', candles: serverCandles }), { status: 200 })
  })

  it('首屏快速图设成只走直连完整历史：不问服务器、不走免密钥快线', async () => {
    await use(conf({ fast: ['geckoterminal'], full: ['geckoterminal'] }))
    const f = await loadFastCandles(input)
    expect(f?.candles).toHaveLength(2)
    expect(seen.every((u) => u.includes('geckoterminal'))).toBe(true)
  })

  it('服务器说自己用不了（serverReady=false）：设置里有服务器也不去问，直接下一条', async () => {
    await use(conf({ fast: ['server', 'dexpaprika'], full: ['server', 'geckoterminal'] }, false))
    expect((await loadFastCandles(input))?.candles.map((c) => c.close)).toEqual([1.1])
    await loadDexCandles(input)
    expect(seen.some((u) => u.includes('/api/candles'))).toBe(false)
  })

  it('预取跟着设置走：完整历史先走服务器时不预取直连，只读服务器缓存；设置里没有服务器就不问服务器', async () => {
    await use(conf({ fast: ['server'], full: ['server', 'geckoterminal'] }))
    prefetchDexCandles(input)
    prefetchServerCandles(input)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toContain('prefetch=1')
    await use(conf({ fast: ['dexpaprika'], full: ['geckoterminal'] }))
    prefetchServerCandles({ ...input, pairAddress: '0xOther' })
    prefetchDexCandles({ ...input, pairAddress: '0xOther' })
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toContain('geckoterminal')
  })

  it('完整历史只剩服务器、服务器又说没开：回「暂无 K 线」而不是一直转圈', async () => {
    server = () => new Response(JSON.stringify({ enabled: false }), { status: 200 })
    await use(conf({ fast: [], full: ['server'] }))
    const d = await loadDexCandles(input)
    expect(d.supported).toBe(false)
    server = () => new Response(JSON.stringify({ enabled: true, source: 'GeckoTerminal', candles: serverCandles }), { status: 200 })
  })
})

// 2026-09-29 goat, web spot page BTCB blank: the device held pre-provisioning settings (ready:false), and the first chart skipped the server channel while the new settings were still in flight
describe('本机存的旧设置', () => {
  it('设置正在从服务器拉：服务器通道等它拉完再决定，用新设置（旧的说没开、新的说开了 → 照样问服务器）', async () => {
    await use(conf({ fast: ['server'], full: ['geckoterminal'] }, false))
    expect(candleConfig().serverReady).toBe(false)
    let open!: () => void
    const gate = new Promise<void>((r) => { open = r })
    config = conf({ fast: ['server'], full: ['geckoterminal'] }, true, 6)
    const base = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { if (url.includes('/api/candles/config')) await gate; return (base as typeof fetch)(url, init) }))
    const refreshing = refreshCandleConfig()
    const fast = loadFastCandles(input)
    open()
    await refreshing
    expect((await fast)?.candles).toHaveLength(1)
    expect(seen.some((u) => u.includes('/api/candles?'))).toBe(true)
  })
  it('阳性对照：新设置也说没开 → 不问服务器', async () => {
    await use(conf({ fast: ['server'], full: ['geckoterminal'] }, false))
    expect(await loadFastCandles(input)).toBeNull()
    expect(seen.some((u) => u.includes('/api/candles?'))).toBe(false)
  })
})
