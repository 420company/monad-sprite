// @vitest-environment jsdom
// When direct LI.FI is rate-limited, switch to the server's fallback channel (2026-10-05 goat's screenshot: the swap reported HTTP 429 Rate limit exceeded).
// Verify: direct connection normally; on direct 429 auto-switch to the server and get the quote this time; go straight to the server for the next hour; if both 429, give one line of Chinese; other errors (no-route 404) still throw outward without switching channels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const API = 'https://api.test'
type Hit = { url: string; status: number; body: unknown }
let script: ((url: string) => Hit | undefined)[] = []
let seen: string[] = []

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SOCIAL_API', API)
  vi.stubEnv('VITE_LIFI_API_KEY', '')
  seen = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    seen.push(String(url))
    const step = script.shift()
    const hit = step?.(String(url)) ?? { url: String(url), status: 200, body: { id: 'q' } }
    return new Response(JSON.stringify(hit.body), { status: hit.status })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

const quoteArgs = { fromChain: 1, toChain: 56, fromToken: '0x0000000000000000000000000000000000000000', toToken: '0x55d398326f99059fF775485246999027B3197955', fromAmount: '7797959021485', fromAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }
const rateLimited = (url: string): Hit => ({ url, status: 429, body: { message: 'Rate limit exceeded, retry in 51 minutes', code: 1005 } })

describe('LI.FI 被限流时改走服务器', () => {
  it('平时直连 LI.FI', async () => {
    const { getLifiQuote } = await import('./lifi')
    script = [(u) => ({ url: u, status: 200, body: { id: 'direct' } })]
    const q = await getLifiQuote(quoteArgs as never)
    expect((q as unknown as { id: string }).id).toBe('direct')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^https:\/\/li\.quest\/v1\/quote\?/)
  })

  it('直连 429：自动换服务器，这次就拿到报价；之后一小时直接走服务器，过了一小时再试直连', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { getLifiQuote, getLifiToken } = await import('./lifi')
    script = [rateLimited, (u) => ({ url: u, status: 200, body: { id: 'proxy' } })]
    const q = await getLifiQuote(quoteArgs as never)
    expect((q as unknown as { id: string }).id).toBe('proxy')
    expect(seen[0]).toMatch(/^https:\/\/li\.quest\/v1\/quote\?/)
    expect(seen[1].startsWith(`${API}/api/lifi/quote?`)).toBe(true)
    expect(seen[1].split('?')[1]).toBe(seen[0].split('?')[1])   // Pass the params through as-is
    seen = []
    script = [(u) => ({ url: u, status: 200, body: { chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18, name: 'USDT', priceUSD: '1' } })]
    await getLifiToken(56, '0x55d398326f99059fF775485246999027B3197955')
    expect(seen).toEqual([`${API}/api/lifi/token?chain=56&token=0x55d398326f99059fF775485246999027B3197955`])
    vi.setSystemTime(Date.now() + 61 * 60_000)
    seen = []
    await getLifiQuote(quoteArgs as never)
    expect(seen[0]).toMatch(/^https:\/\/li\.quest\//)
  })

  it('两边都 429：给一句中文，不把英文原文甩给用户', async () => {
    const { getLifiQuote } = await import('./lifi')
    const { t } = await import('./i18n')
    script = [rateLimited, (u) => ({ url: u, status: 429, body: { message: '请求太频繁，请稍后再试', code: 'BUSY' } })]
    const err = await getLifiQuote(quoteArgs as never).catch((e: Error) => e)
    expect((err as Error).message).toBe(t('报价服务繁忙，请过几分钟再试'))   // The test env may be in English — compare per current language
    expect((err as Error).message).not.toMatch(/HTTP 429|Rate limit/)
  })

  it('没路线（404）照旧往外抛、不换通道（前端据此显示「暂无路线」）', async () => {
    const { getLifiQuote } = await import('./lifi')
    script = [(u) => ({ url: u, status: 404, body: { message: 'No available quotes for the requested transfer' } })]
    await expect(getLifiQuote(quoteArgs as never)).rejects.toThrow(/HTTP 404/)
    expect(seen).toHaveLength(1)
  })
})
