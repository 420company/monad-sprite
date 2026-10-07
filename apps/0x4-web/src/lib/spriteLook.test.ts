// @vitest-environment jsdom
// 问小精灵（2026-10-02 goat 第三批）：流式读它的回答。服务器用替身，不连网。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { askSpriteLook, parseSse } from './spriteLook'
import type { ChartBrief } from './chartBrief'

const brief: ChartBrief = { market: 'perp', symbol: 'BTC', interval: '15m', bars: 300, last: 86000, chgAll: 0.03, chgRecent: -0.004, hi: 86900, lo: 83100, upBars: 4 }
const sse = (...evs: unknown[]) => evs.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
/** 把一段文字切成几块流出来（模拟网络把一个事件拆成两半） */
function streamOf(text: string, cuts: number[]) {
  const enc = new TextEncoder()
  const parts: string[] = []
  let at = 0
  for (const c of [...cuts, text.length]) { parts.push(text.slice(at, c)); at = c }
  return new ReadableStream<Uint8Array>({ start(ctrl) { for (const p of parts) ctrl.enqueue(enc.encode(p)); ctrl.close() } })
}
afterEach(() => { vi.unstubAllGlobals() })

describe('问小精灵', () => {
  it('切事件：收完的解析出来，半截的留到下一块；不是 JSON 的跳过', () => {
    const a = parseSse('data: {"type":"delta","text":"价"}\n\ndata: {"type":"de')
    expect(a.events).toEqual([{ type: 'delta', text: '价' }])
    expect(a.rest).toBe('data: {"type":"de')
    expect(parseSse('data: 不是JSON\n\n: 注释\n\n').events).toEqual([])
  })

  it('边说边回调，最后拿到整句；请求带着摘要和登录令牌以外不带别的', async () => {
    const body = sse({ type: 'delta', text: '价格', textEn: 'Price' }, { type: 'delta', text: '价格在高位', textEn: 'Price is high' }, { type: 'done', reply: { text: '价格在高位。', textEn: 'Price is high.', ts: 5 } })
    const fetchMock = vi.fn(async (_u: string, _init: RequestInit) => new Response(streamOf(body, [17, 60]), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: string[] = []
    const r = await askSpriteLook('fly_1', brief, (p) => seen.push(p.text))
    expect(seen).toEqual(['价格', '价格在高位'])
    expect(r).toEqual({ text: '价格在高位。', textEn: 'Price is high.', ts: 5 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/flies\/fly_1\/look\?stream=1$/)
    expect(JSON.parse(String(init.body))).toEqual({ brief })
  })

  it('服务器在流里报错、流断在半路、接口直接拒绝：都抛错并带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(sse({ type: 'delta', text: '价' }, { type: 'error', status: 503, error: '它现在没有回应，稍后再试' }), []), { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    await expect(askSpriteLook('f', brief, () => {})).rejects.toMatchObject({ status: 503 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(sse({ type: 'delta', text: '价' }), []), { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    await expect(askSpriteLook('f', brief, () => {})).rejects.toMatchObject({ status: 503 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '问得太频繁了，让它歇一会儿' }), { status: 429, headers: { 'content-type': 'application/json' } })))
    await expect(askSpriteLook('f', brief, () => {})).rejects.toMatchObject({ status: 429 })
  })

  it('不是流（被代理攒成一整块 JSON）也能读', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ reply: { text: '量缩了。', textEn: 'Volume dried up.' } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await askSpriteLook('f', brief, () => {})).toMatchObject({ text: '量缩了。', textEn: 'Volume dried up.' })
  })
})
