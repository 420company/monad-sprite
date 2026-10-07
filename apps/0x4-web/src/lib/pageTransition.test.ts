// @vitest-environment jsdom
// 页面切换动画（2026-09-29 goat：「切换很生硬」）：方向判断、右滑返回不重复播、减弱动态效果 / 不支持时直接切换
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markNextNav, navDirection, runWithTransition, takeHint, withPageTransitions, type NavStep, webNavDirection } from './pageTransition'

const step = (o: Partial<NavStep>): NavStep => ({ from: '/discover', to: '/token/bsc/0xabc', action: 'PUSH', delta: null, hint: null, native: true, coarse: true, ...o })

describe('方向判断', () => {
  it('进入下一级是 forward，返回（历史后退）是 back', () => {
    expect(navDirection(step({}))).toBe('forward')
    expect(navDirection(step({ from: '/token/bsc/0xabc', to: '/discover', action: 'POP', delta: -1 }))).toBe('back')
    expect(navDirection(step({ from: '/discover', to: '/token/bsc/0xabc', action: 'POP', delta: 1 }))).toBe('forward')
  })
  it('底部标签之间（点标签、或从下一级页面点标签栏）是 tab，只淡入淡出', () => {
    expect(navDirection(step({ from: '/', to: '/discover' }))).toBe('tab')
    expect(navDirection(step({ from: '/token/bsc/0xabc', to: '/settings' }))).toBe('tab')
    expect(navDirection(step({ from: '/discover', to: '/', action: 'POP', delta: -1 }))).toBe('tab')
  })
  it('同一页面只换参数、路由守卫的替换跳转、右滑返回：不做整页动画', () => {
    expect(navDirection(step({ from: '/fly/1', to: '/fly/1' }))).toBe('none')
    expect(navDirection(step({ action: 'REPLACE' }))).toBe('none')
    expect(navDirection(step({ from: '/token/bsc/0xabc', to: '/discover', action: 'POP', delta: -1, hint: 'none' }))).toBe('none')
  })
  it('返回按钮没有上一页时是「替换成上级页面」，带 back 提示照样播返回', () => {
    expect(navDirection(step({ from: '/fly/1', to: '/flies', action: 'REPLACE', hint: 'back' }))).toBe('back')
  })
  it('手机浏览器里用浏览器自己的后退手势：浏览器已播过动画，不再叠；App 内返回按钮（带提示）照播', () => {
    const pop = { from: '/token/bsc/0xabc', to: '/discover', action: 'POP', delta: -1 }
    expect(navDirection(step({ ...pop, native: false, coarse: true }))).toBe('none')
    expect(navDirection(step({ ...pop, native: false, coarse: true, hint: 'back' }))).toBe('back')
    expect(navDirection(step({ ...pop, native: false, coarse: false }))).toBe('back')   // 电脑浏览器的后退按钮照播
  })
  it('提示只管紧接着的那一次导航，1 秒后作废', () => {
    markNextNav('none', 1000)
    expect(takeHint(1500)).toBe('none')
    expect(takeHint(1600)).toBeNull()
    markNextNav('back', 1000)
    expect(takeHint(2500)).toBeNull()
  })
})

describe('执行过渡', () => {
  let startCalls = 0
  let inTransition = false
  beforeEach(() => {
    startCalls = 0
    ;(document as unknown as { startViewTransition?: unknown }).startViewTransition = (cb: () => void) => {
      startCalls++
      inTransition = true
      cb()
      inTransition = false
      return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: Promise.resolve() }
    }
  })
  afterEach(() => { delete (document as unknown as { startViewTransition?: unknown }).startViewTransition; delete document.documentElement.dataset.nav })

  it('forward：用过渡包住更新，<html data-nav> 标上方向，结束后清掉', async () => {
    const update = vi.fn(() => { expect(document.documentElement.dataset.nav).toBe('forward') })
    expect(runWithTransition('forward', update, document, () => false)).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(startCalls).toBe(1)
    await Promise.resolve(); await Promise.resolve()
    expect(document.documentElement.dataset.nav).toBeUndefined()
  })
  it('减弱动态效果：直接更新，不开过渡', () => {
    const update = vi.fn()
    expect(runWithTransition('forward', update, document, () => true)).toBe(false)
    expect(update).toHaveBeenCalledTimes(1)
    expect(startCalls).toBe(0)
  })
  it('系统不支持 View Transitions：直接更新', () => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    const update = vi.fn()
    expect(runWithTransition('back', update, document, () => false)).toBe(false)
    expect(update).toHaveBeenCalledTimes(1)
  })
  it('none：不开过渡', () => {
    const update = vi.fn()
    runWithTransition('none', update, document, () => false)
    expect(startCalls).toBe(0)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('包过的历史：每次路由变化按方向调用；右滑返回（none 提示）不再播一遍', () => {
    const listeners: ((u: { action: string; location: { pathname: string }; delta: number | null }) => void)[] = []
    const fake = { location: { pathname: '/discover' }, listen: (fn: (u: never) => void) => { listeners.push(fn as never); return () => {} } }
    const h = withPageTransitions(fake as unknown as Parameters<typeof withPageTransitions>[0], { native: true, coarse: () => true })
    const seen: string[] = []
    // 记下每次更新是不是在过渡里执行的、当时标的方向
    h.listen(((u: { location: { pathname: string } }) => { seen.push(`${u.location.pathname}:${inTransition ? document.documentElement.dataset.nav : '-'}`) }) as never)
    const go = (pathname: string, action = 'PUSH', delta: number | null = null) => listeners[0]({ action, location: { pathname }, delta })
    go('/token/bsc/0xabc')                  // 进入下一级
    markNextNav('none'); go('/discover', 'POP', -1)   // 右滑返回
    markNextNav('back'); go('/token/bsc/0xabc', 'PUSH'); // 提示被上一次用掉了吗？这里重新给了 back，按 back 播
    go('/settings')                          // 点标签栏
    expect(seen).toEqual(['/token/bsc/0xabc:forward', '/discover:-', '/token/bsc/0xabc:back', '/settings:tab'])
    expect(startCalls).toBe(3)
  })
})

describe('返回入口告诉动画方向', () => {
  it('Android 返回键 / 返回按钮走 goBack：播返回；iOS 右滑返回：不再播', async () => {
    const { goBack } = await import('./swipeBack')
    const nav = vi.fn()
    goBack(nav as never)
    expect(takeHint()).toBe('back')
    goBack(nav as never, 'none')
    expect(takeHint()).toBe('none')
  })
})

// 电脑网页版（2026-09-30 goat：整页滑走不舒服）：同栏目不动，换栏目只淡入淡出
describe('webNavDirection', () => {
  it('现货里换币种、现货列表进单个币：整页不动', () => {
    expect(webNavDirection('/token/solana/AAA', '/token/bsc/BBB', 'forward')).toBe('none')
    expect(webNavDirection('/spot', '/token/bsc/BBB', 'forward')).toBe('none')
    expect(webNavDirection('/token/bsc/BBB', '/spot', 'back')).toBe('none')
  })
  it('换栏目：淡入淡出，不横推', () => {
    expect(webNavDirection('/discover', '/perp', 'forward')).toBe('fade')
    expect(webNavDirection('/portfolio', '/settings', 'tab')).toBe('fade')
    expect(webNavDirection('/settings', '/u/abc', 'back')).toBe('fade')
  })
  it('本来就不做动画的照旧不做', () => {
    expect(webNavDirection('/discover', '/perp', 'none')).toBe('none')
  })
  it('网页版历史：换栏目播 fade', () => {
    const listeners: ((u: { action: string; location: { pathname: string } }) => void)[] = []
    const fake = { location: { pathname: '/discover' }, listen: (fn: (u: { action: string; location: { pathname: string } }) => void) => { listeners.push(fn); return () => {} } }
    const h = withPageTransitions(fake as unknown as Parameters<typeof withPageTransitions>[0], { native: false, coarse: () => false, web: true })
    const seen: string[] = []
    h.listen(() => { seen.push(document.documentElement.dataset.nav ?? '') })
    listeners[0]({ action: 'PUSH', location: { pathname: '/token/bsc/X' } })
    expect(seen.length).toBe(1)
  })
})
