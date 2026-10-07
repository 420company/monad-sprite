// External browser vs auto-lock (2026-09-28 GPT review #2):
// openExternal used to always attach the "don't lock" exemption, lifted only when a deep link jumped back; after the user closed the browser directly (done with the game, done with someone's X profile),
// the exemption never lifted, so backgrounding and foreground idleness never locked the wallet again. Now: plain browsing gets no exemption; flows that jump back get one, released when the browser closes or jumps back — exactly once.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ finished: null as null | (() => void), suspend: 0, resume: 0, openFails: false }))

vi.mock('@capacitor/core', async (orig) => {
  const actual = await orig<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => 'ios' } }
})
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(async () => { if (h.openFails) throw new Error('打不开') }),
    close: vi.fn(async () => { h.finished?.() }),   // On real devices the OS also fires browserFinished after close
    addListener: vi.fn(async (_e: string, fn: () => void) => { h.finished = fn; return { remove: async () => {} } }),
  },
}))
vi.mock('@/lib/autolock', () => ({ suspendAutoLock: () => { h.suspend++ }, resumeAutoLock: () => { h.resume++ } }))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('openExternal 与自动锁定', () => {
  beforeEach(() => { h.suspend = 0; h.resume = 0; h.openFails = false })

  it('普通浏览（游戏观察、X 主页）不暂停自动锁定', async () => {
    const { openExternal } = await import('./native')
    await openExternal('https://420.meme/game/?watch=x')
    expect(h.suspend).toBe(0)
  })

  it('要跳回的流程挂豁免，用户直接关掉浏览器时释放', async () => {
    const { openExternal } = await import('./native')
    await openExternal('https://x.com/i/oauth2/authorize', { holdUnlock: true })
    expect(h.suspend).toBe(1)
    expect(h.resume).toBe(0)
    h.finished?.()
    await flush()
    expect(h.resume).toBe(1)
    // A second close event must not release again (or it would early-release another flow's exemption)
    h.finished?.()
    await flush()
    expect(h.resume).toBe(1)
  })

  it('深度链接跳回（closeExternal）释放一次，随后的关闭事件不重复释放', async () => {
    const { openExternal, closeExternal } = await import('./native')
    await openExternal('https://x.com/i/oauth2/authorize', { holdUnlock: true })
    await closeExternal()
    await flush()
    expect(h.suspend).toBe(1)
    expect(h.resume).toBe(1)
  })

  it('浏览器打不开时立刻释放', async () => {
    const { openExternal } = await import('./native')
    h.openFails = true
    await expect(openExternal('wc://wc?uri=x', { holdUnlock: true })).rejects.toThrow()
    expect(h.suspend).toBe(1)
    expect(h.resume).toBe(1)
  })
})
