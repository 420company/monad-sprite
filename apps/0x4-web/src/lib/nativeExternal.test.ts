// 外部浏览器与自动锁定（2026-09-28 GPT 审查 #2）：
// 原来 openExternal 一律挂「不锁」豁免，只有深度链接跳回才解除；用户直接关掉浏览器（看完游戏、看完别人的 X 主页）后，
// 豁免永远不解除，之后切后台、前台闲置都不再锁钱包。现在：普通浏览不挂豁免；要跳回的流程挂豁免，浏览器关闭或跳回时释放，且只释放一次。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ finished: null as null | (() => void), suspend: 0, resume: 0, openFails: false }))

vi.mock('@capacitor/core', async (orig) => {
  const actual = await orig<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => 'ios' } }
})
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(async () => { if (h.openFails) throw new Error('打不开') }),
    close: vi.fn(async () => { h.finished?.() }),   // 真机上 close 之后系统也会发 browserFinished
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
    // 再来一次关闭事件不能多释放（否则会提前解除别的流程的豁免）
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
