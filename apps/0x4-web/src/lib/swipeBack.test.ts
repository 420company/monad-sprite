// @vitest-environment jsdom
// Back gesture (2026-09-29): iOS left-edge swipe-right, Android back key — same logic as the page's back button
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { NavigateFunction } from 'react-router-dom'
import { goBack, handleAndroidBack, installBackGestures, installSwipeBack, swipeBackAllowedPath, EMERGE_MS } from './swipeBack'
import { useBack } from './useBack'

let root: HTMLDivElement
let clock = 0
let undo: () => void = () => {}
const onBack = vi.fn()
let allowed = true
let reduced = false

function touch(type: string, x: number, y: number, target: EventTarget = root) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const pts = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }]
  Object.defineProperty(e, 'touches', { value: pts })
  target.dispatchEvent(e)
  return e
}
/** One complete swipe: press at (x0,y0), move through steps in order (dt ms per step), release at the end */
function swipe(x0: number, y0: number, steps: [number, number][], dt = 30, target: EventTarget = root) {
  touch('touchstart', x0, y0, target)
  const moves = steps.map(([x, y]) => { clock += dt; return touch('touchmove', x, y, target) })
  touch('touchend', 0, 0, target)
  return moves
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0))
  root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  onBack.mockReset(); allowed = true; reduced = false; clock = 0
  undo = installSwipeBack({ root, allowed: () => allowed, onBack, reducedMotion: () => reduced, now: () => clock, width: () => 375 })
})
afterEach(() => { undo(); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('哪些页面能手势返回', () => {
  it('底部五个标签页首页、解锁页、引导页不能；其他有返回按钮的页面能', () => {
    for (const p of ['/', '/discover', '/community', '/live', '/settings', '/unlock', '/onboarding', '/onboarding/import']) expect(swipeBackAllowedPath(p)).toBe(false)
    for (const p of ['/token/solana/abc', '/fly/f1', '/swap', '/g/x', '/notifications']) expect(swipeBackAllowedPath(p)).toBe(true)
  })
})

describe('iOS 左边缘右滑', () => {
  it('从左边缘开始往右拖过 35% 宽度：页面跟手，松手滑出后返回，位置复原', () => {
    const moves = swipe(8, 300, [[30, 302], [120, 305], [200, 306]], 60)
    expect(moves[1].defaultPrevented).toBe(true)   // Once confirmed as a back gesture, the page doesn't scroll
    expect(root.style.transform).toContain('px')
    expect(onBack).not.toHaveBeenCalled()          // Slide out first, then change the page
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
    // After the page change, the previous page returns from the dimmer left to its place; all styles are cleared at the end
    expect(root.style.transform).toMatch(/translate3d\(0/)
    vi.advanceTimersByTime(EMERGE_MS + 40)
    expect(root.style.transform).toBe('')
    expect(root.style.opacity).toBe('')
  })

  it('从屏幕中间明显横着往右滑也能返回（iOS 26 习惯，goat 9/29 真机反馈）', () => {
    const moves = swipe(150, 300, [[175, 302], [260, 305], [330, 306]], 40)
    expect(moves[1].defaultPrevented).toBe(true)
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('从屏幕中间斜着滑（竖向超过横向一半）不触发，交给页面滚动（对照：边缘开始同样的斜度会触发）', () => {
    const moves = swipe(150, 300, [[170, 312], [220, 330], [300, 370]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(moves.every((m) => !m.defaultPrevented)).toBe(true)
    swipe(8, 300, [[30, 312], [100, 340], [220, 380]], 60)
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('手指落在滑块、输入框、按住说话按钮上不触发', () => {
    for (const html of ['<input type="range">', '<textarea></textarea>', '<div role="slider"></div>', '<button data-swipe-back="off"></button>']) {
      root.innerHTML = html
      swipe(150, 300, [[200, 300], [340, 300]], 30, root.firstElementChild!)
      vi.advanceTimersByTime(300)
    }
    expect(onBack).not.toHaveBeenCalled()
  })

  it('竖着滑（滚动页面）不触发，也不拦页面滚动', () => {
    const moves = swipe(8, 300, [[12, 340], [200, 400]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(moves.every((m) => !m.defaultPrevented)).toBe(true)
  })

  it('拖得不够、速度也慢：弹回，不返回', () => {
    swipe(8, 300, [[30, 300], [60, 300]], 500)
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(root.style.transform).toBe('')
  })

  it('距离不到 35% 但往右甩得快：返回', () => {
    swipe(8, 300, [[40, 300], [90, 300]], 15)
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('弹窗开着不触发', () => {
    const d = document.createElement('dialog'); d.setAttribute('open', ''); document.body.appendChild(d)
    swipe(8, 300, [[120, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('页面上挂着关着的底部弹层（<dialog aria-modal> 没有 open）不挡手势；打开后才挡（goat 9/29 真机右滑没反应的根因）', () => {
    const d = document.createElement('dialog'); d.setAttribute('aria-modal', 'true'); document.body.appendChild(d)
    swipe(8, 300, [[40, 300], [120, 300], [220, 300]], 60)
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(EMERGE_MS + 40)
    d.setAttribute('open', '')
    swipe(8, 300, [[40, 300], [120, 300], [220, 300]], 60)
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('正在输入时不触发', () => {
    const i = document.createElement('input'); document.body.appendChild(i); i.focus()
    swipe(8, 300, [[120, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('标签页首页（当前页面不允许）不触发', () => {
    allowed = false
    swipe(8, 300, [[120, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('手指落在图表画布或标了关闭的区域里不触发', () => {
    const c = document.createElement('canvas'); root.appendChild(c)
    swipe(8, 300, [[120, 300], [300, 300]], 30, c)
    const off = document.createElement('div'); off.dataset.swipeBack = 'off'; const inner = document.createElement('span'); off.appendChild(inner); root.appendChild(off)
    swipe(8, 300, [[120, 300], [300, 300]], 30, inner)
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('系统减弱动态效果：页面不跟手平移，松手直接返回', () => {
    reduced = true
    touch('touchstart', 8, 300); clock += 60; touch('touchmove', 120, 300); clock += 60; touch('touchmove', 250, 300)
    expect(root.style.transform).toBe('')
    touch('touchend', 0, 0)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('和返回按钮同一套逻辑', () => {
  it('有上一页退回；没有就去页面登记的上级页面；都没有回首页', () => {
    const nav = vi.fn() as unknown as NavigateFunction
    window.history.replaceState({ idx: 3 }, '')
    goBack(nav)
    expect(nav).toHaveBeenLastCalledWith(-1)
    window.history.replaceState({ idx: 0 }, '')
    goBack(nav)
    expect(nav).toHaveBeenLastCalledWith('/', { replace: true })
    // The page registers its parent via useBack('/discover')
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    const Page = () => { useBack('/discover'); return null }
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    act(() => r.render(createElement(MemoryRouter, null, createElement(Page))))
    goBack(nav)
    expect(nav).toHaveBeenLastCalledWith('/discover', { replace: true })
    act(() => r.unmount())
    goBack(nav)
    expect(nav).toHaveBeenLastCalledWith('/', { replace: true })
  })
})

describe('Android 返回键', () => {
  it('有弹窗先关弹窗；有返回按钮的页面走返回；标签页首页交回系统照旧处理', () => {
    const nav = vi.fn() as unknown as NavigateFunction
    window.history.replaceState({ idx: 2 }, '')
    const d = document.createElement('dialog'); d.setAttribute('open', ''); document.body.appendChild(d)
    const cancel = vi.fn(); d.addEventListener('cancel', cancel)
    const e1 = new Event('0x4:back', { cancelable: true })
    handleAndroidBack(e1, '/token/solana/x', nav)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(e1.defaultPrevented).toBe(true)
    expect(nav).not.toHaveBeenCalled()
    d.remove()
    const e2 = new Event('0x4:back', { cancelable: true })
    handleAndroidBack(e2, '/token/solana/x', nav)
    expect(nav).toHaveBeenLastCalledWith(-1)
    expect(e2.defaultPrevented).toBe(true)
    const e3 = new Event('0x4:back', { cancelable: true })
    handleAndroidBack(e3, '/discover', nav)
    expect(e3.defaultPrevented).toBe(false)
    expect(nav).toHaveBeenCalledTimes(1)
  })

  it('Android 原生接返回键事件、不挂网页右滑；网页版什么都不挂', () => {
    undo()
    const nav = vi.fn() as unknown as NavigateFunction
    window.history.replaceState({ idx: 1 }, '')
    const off = installBackGestures(() => '/fly/f1', nav, { native: true, platform: 'android' })
    const e = new Event('0x4:back', { cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(nav).toHaveBeenCalledWith(-1)
    swipe(8, 300, [[120, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(nav).toHaveBeenCalledTimes(1)
    off()
    const offWeb = installBackGestures(() => '/fly/f1', nav, { native: false, platform: 'web' })
    const e2 = new Event('0x4:back', { cancelable: true })
    window.dispatchEvent(e2)
    swipe(8, 300, [[120, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(e2.defaultPrevented).toBe(false)
    expect(nav).toHaveBeenCalledTimes(1)
    offWeb()
    undo = () => {}
  })
})

describe('Android 返回键关弹窗（React 组件）', () => {
  it('发给最上面弹窗的 cancel 能被 React 的 onCancel 收到（Sheet / AlertDialog 就是靠它关）', () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    const onCancel = vi.fn()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    act(() => r.render(createElement('dialog', { open: true, onCancel: (e: Event) => { if (e.target === e.currentTarget) onCancel() } })))
    handleAndroidBack(new Event('0x4:back', { cancelable: true }), '/token/solana/x', vi.fn() as unknown as NavigateFunction)
    expect(onCancel).toHaveBeenCalledTimes(1)
    act(() => r.unmount())
  })
})
