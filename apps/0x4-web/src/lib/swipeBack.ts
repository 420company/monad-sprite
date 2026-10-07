// 返回手势（2026-09-29 goat：「有返回按钮的页面，现在无法通过手机触屏向右划一下就返回上一页的功能」）。
//
// iOS：自己实现左边缘右滑。没用 WKWebView 自带的 allowsBackForwardNavigationGestures，因为它只认浏览器历史：
//   底部五个标签页之间切换也压了历史，会被它滑回上一个标签；从推送、深链直接打开的页面没有上一条历史，
//   它什么都不做，和返回按钮「没有上一页就去上级页面」（useBack）对不上；解锁页、引导页也会被滑走；
//   它退回时显示的是离开前截的快照，页面重新渲染后会跳一下。自己实现可以只在有返回按钮的页面生效、走和返回按钮同一套逻辑。
// Android：系统返回手势 / 返回键都会触发 Capacitor 的 backButton，native.ts 把它转成「0x4:back」事件交给这里，
//   和 iOS 手势、页面返回按钮走同一套逻辑；有弹窗开着先关弹窗。Android 上不再叠加网页右滑，免得和系统手势抢。
// 网页版不开：手机浏览器自己有边缘滑动返回，再叠一层会退两页；桌面用鼠标本来就不会产生触摸事件。
import { canGoBack, pageFallback } from './useBack'
import { markNextNav, type NavDir } from './pageTransition'
import { isNative, platform } from './native'
import type { NavigateFunction } from 'react-router-dom'

/** 从屏幕左边多少像素以内开始算「边缘右滑」（和 iOS 系统边缘手势的范围差不多），判断宽松一些 */
export const EDGE_PX = 24
// 2026-09-29 goat 真机（iOS 26.6）：「手机屏幕上划动来使用后退功能也没有啊」。iOS 26 系统本身支持在内容任意位置右滑返回，
// 用户习惯从屏幕中间划，只认最左 24px 等于没有。现在从任意位置开始都可以，只是不在边缘开始时方向要更明显是横着往右（见 classify）。
/** 松手时拖过屏幕宽度的这个比例就返回 */
export const COMMIT_RATIO = 0.35
/** 或者往右甩的速度（像素 / 毫秒）够快、且至少拖了 COMMIT_MIN_PX */
export const COMMIT_VELOCITY = 0.5
export const COMMIT_MIN_PX = 40
/** 手指移动超过这个距离才判断方向 */
const SLOP = 10
const ANIM_MS = 200
/** 换页后上一页从左边回到原位的时长（和页面切换动画 index.css 的「返回」同一条曲线） */
export const EMERGE_MS = 280

/** 底部五个标签页的首页没有返回按钮；解锁页、引导页不能用手势离开 */
const ROOTS = new Set(['/', '/discover', '/community', '/live', '/settings'])
export function swipeBackAllowedPath(pathname: string): boolean {
  if (ROOTS.has(pathname)) return false
  if (pathname === '/unlock' || pathname.startsWith('/onboarding')) return false
  return true
}

/**
 * 弹窗 / 对话框开着、正在输入时不响应（弹窗该由它自己的关闭方式处理，打字时键盘弹着不该把页面拖走）。
 * ★只认真正打开着的：底部弹层（Sheet）是 <dialog aria-modal="true">，关着的时候也一直挂在页面上、带着 aria-modal，
 *   以前按 [aria-modal] 判断，只要页面放了弹层（闪兑、币详情等几乎所有功能页）手势就永远不响应——goat 9/29 真机「右滑返回没有」的根因。
 *   <dialog> 看 open；不是 <dialog> 的模态（图片查看器这类只在打开时才渲染）照旧按 aria-modal 算。
 */
export function blockedByUi(doc: Document = document): boolean {
  if (doc.querySelector('dialog[open], [aria-modal="true"]:not(dialog)')) return true
  const a = doc.activeElement as HTMLElement | null
  return !!a?.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** 手指落在横向能滚的区域、图表画布、或标了 data-swipe-back="off" 的元素里时不响应，留给它们自己的拖动 */
export function blockedByTarget(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement) {
    if (el instanceof HTMLCanvasElement) return true
    // 滑块、输入框里的拖动留给它们自己（仓位比例、杠杆这类滑块本来就是左右拖）
    if (el.matches('input, textarea, select, [role="slider"]')) return true
    const h = el as HTMLElement
    if (h.dataset?.swipeBack === 'off') return true
    if (h.scrollWidth > h.clientWidth + 1) {
      const ox = getComputedStyle(h).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * 手指移动后判断：竖着滑或往左 → 放弃（交给页面滚动）；明显往右 → 开始拖；还不确定 → 继续等。
 * 从边缘开始的按原来的宽松标准；从屏幕中间开始的要更明显是横着往右（横向至少是竖向的 2 倍、且移动超过 16px），免得和上下滚动抢
 */
export function classify(dx: number, dy: number, fromEdge = true): 'pending' | 'drag' | 'abort' {
  if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) return 'abort'
  if (dx < -SLOP) return 'abort'
  if (fromEdge) {
    if (dx > SLOP && dx > Math.abs(dy) * 1.2) return 'drag'
  } else {
    if (Math.abs(dy) > SLOP && Math.abs(dy) * 2 > dx) return 'abort'
    if (dx > 16 && dx > Math.abs(dy) * 2) return 'drag'
  }
  return 'pending'
}

/** 松手：拖过屏幕宽度 35%，或者往右甩得够快就返回，否则弹回 */
export function shouldCommit(dx: number, width: number, velocity: number): boolean {
  return dx >= width * COMMIT_RATIO || (velocity >= COMMIT_VELOCITY && dx >= COMMIT_MIN_PX)
}

/**
 * 和页面返回按钮（useBack）同一套：有上一页就退回，没有就去这个页面登记的上级页面，都没登记就回首页。
 * transition：页面切换动画（lib/pageTransition.ts）。Android 返回键播「返回」动画；
 * iOS 右滑返回传 'none'：页面已经跟着手指滑出去了，不能再播一遍
 */
export function goBack(navigate: NavigateFunction, transition: NavDir = 'back') {
  markNextNav(transition)
  if (canGoBack()) navigate(-1)
  else navigate(pageFallback() || '/', { replace: true })
}

type Pt = { clientX: number; clientY: number }
export interface SwipeBackOptions {
  /** 跟手平移的元素（整个 App 根节点） */
  root: HTMLElement
  /** 当前页面能不能手势返回 */
  allowed: () => boolean
  onBack: () => void
  reducedMotion?: () => boolean
  now?: () => number
  width?: () => number
}

/** 挂上左边缘右滑，返回卸载函数 */
export function installSwipeBack(o: SwipeBackOptions): () => void {
  const now = o.now ?? (() => performance.now())
  const width = o.width ?? (() => window.innerWidth || o.root.clientWidth || 375)
  const reduced = o.reducedMotion ?? (() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  let s: { x0: number; y0: number; lastX: number; lastT: number; v: number; drag: boolean; edge: boolean } | null = null
  let busy = false
  const style = o.root.style

  const paint = (x: number, animate: boolean) => {
    style.transition = animate ? `transform ${ANIM_MS}ms cubic-bezier(.2,.8,.2,1)` : 'none'
    style.transform = `translate3d(${x}px,0,0)`
    style.boxShadow = '-16px 0 28px rgba(0,0,0,.28)'
    style.willChange = 'transform'
  }
  const clear = () => { style.transition = ''; style.transform = ''; style.boxShadow = ''; style.willChange = ''; style.opacity = '' }
  const settle = (x: number, then: () => void) => {
    busy = true
    paint(x, true)
    setTimeout(() => { then(); busy = false }, ANIM_MS + 20)
  }

  const emerge = (w: number) => {
    busy = true
    style.transition = 'none'
    style.boxShadow = ''
    style.transform = `translate3d(${-Math.round(w * 0.28)}px,0,0)`
    style.opacity = '.55'
    void o.root.offsetWidth   // 先落到起点，再开始过渡
    style.transition = `transform ${EMERGE_MS}ms cubic-bezier(.33,1,.68,1), opacity ${EMERGE_MS}ms ease-out`
    style.transform = 'translate3d(0,0,0)'
    style.opacity = '1'
    setTimeout(() => { clear(); busy = false }, EMERGE_MS + 20)
  }

  const onStart = (e: TouchEvent) => {
    if (busy || s || e.touches.length !== 1) return
    const t = e.touches[0] as Pt
    if (!o.allowed() || blockedByUi(o.root.ownerDocument) || blockedByTarget(e.target)) return
    s = { x0: t.clientX, y0: t.clientY, lastX: t.clientX, lastT: now(), v: 0, drag: false, edge: t.clientX <= EDGE_PX }
  }
  const onMove = (e: TouchEvent) => {
    if (!s) return
    if (e.touches.length !== 1) { if (s.drag) settle(0, clear); s = null; return }
    const t = e.touches[0] as Pt
    const dx = t.clientX - s.x0
    if (!s.drag) {
      const d = classify(dx, t.clientY - s.y0, s.edge)
      if (d === 'abort') { s = null; return }
      if (d === 'pending') return
      s.drag = true
    }
    e.preventDefault()   // 已经确定是返回手势：不让页面跟着滚
    const at = now(), dt = at - s.lastT
    if (dt > 0) s.v = 0.8 * ((t.clientX - s.lastX) / dt) + 0.2 * s.v
    s.lastX = t.clientX; s.lastT = at
    if (!reduced()) paint(Math.max(0, dx), false)
  }
  const onEnd = () => {
    if (!s) return
    const g = s
    s = null
    if (!g.drag) return
    const w = width()
    if (!shouldCommit(g.lastX - g.x0, w, g.v)) { if (reduced()) clear(); else settle(0, clear); return }
    if (reduced()) { clear(); o.onBack(); return }
    // 滑出去之后再换页。换完上一页从左边略暗处回到原位（和「返回」过渡的后半段一样），不再是原地突然出现
    settle(w, () => { o.onBack(); requestAnimationFrame(() => emerge(w)) })
  }
  const onCancel = () => { if (s?.drag) settle(0, clear); s = null }

  const doc = o.root.ownerDocument
  doc.addEventListener('touchstart', onStart, { passive: true })
  doc.addEventListener('touchmove', onMove, { passive: false })
  doc.addEventListener('touchend', onEnd, { passive: true })
  doc.addEventListener('touchcancel', onCancel, { passive: true })
  return () => {
    doc.removeEventListener('touchstart', onStart)
    doc.removeEventListener('touchmove', onMove)
    doc.removeEventListener('touchend', onEnd)
    doc.removeEventListener('touchcancel', onCancel)
    clear()
  }
}

/**
 * Android 返回键 / 返回手势（native.ts 转来的「0x4:back」事件）：
 * 有弹窗开着先关最上面那个（和系统习惯一致）；页面有返回按钮就走返回逻辑；标签页首页不接，交回 native.ts 照旧处理（退到后台）
 */
export function handleAndroidBack(e: Event, path: string, navigate: NavigateFunction) {
  const dialogs = document.querySelectorAll('dialog[open]')
  const top = dialogs[dialogs.length - 1]
  if (top) {
    e.preventDefault()
    top.dispatchEvent(new Event('cancel', { cancelable: true }))
    return
  }
  if (!swipeBackAllowedPath(path)) return
  e.preventDefault()
  goBack(navigate)
}

/** App 根组件调用：iOS 原生挂左边缘右滑，Android 原生接返回键事件；网页版不做（浏览器自带） */
export function installBackGestures(path: () => string, navigate: NavigateFunction, env: { native: boolean; platform: string } = { native: isNative, platform }): () => void {
  if (!env.native) return () => {}
  if (env.platform === 'android') {
    const onBack = (e: Event) => handleAndroidBack(e, path(), navigate)
    window.addEventListener('0x4:back', onBack)
    return () => window.removeEventListener('0x4:back', onBack)
  }
  const root = document.getElementById('root')
  if (!root) return () => {}
  return installSwipeBack({ root, allowed: () => swipeBackAllowedPath(path()), onBack: () => goBack(navigate, 'none') })
}
