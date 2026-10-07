// 页面切换动画（2026-09-29 goat：「如果有界面切换那些，要做的丝滑一点，现在切换很生硬」）。
//
// 做法：路由换成 unstable_HistoryRouter + 自己包一层的哈希历史。历史每变一次（点链接、返回按钮、返回手势、Android 返回键、
// 浏览器前进后退都走这里），先判断方向，再用 View Transitions API 包住这一次路由状态更新：
// 浏览器先截下旧页，flushSync 同步渲染新页，再按 <html data-nav> 播放 index.css 里对应的动画。
//   · 进入下一级页面（forward）：新页从右边推进来，旧页往左让一点并变暗，和 iOS 原生导航一致
//   · 返回（back）：反过来，旧页往右滑走，上一页从左边回到原位
//   · 底部五个标签之间（tab）：不横推，只做很短的淡入淡出，接近 iOS 标签栏的「原地切换」
//   · 同一个页面只换了参数（页内标签、筛选）、路由守卫的改写跳转、右滑返回（页面已经跟着手指滑出去了）：不做整页动画
// 没有 View Transitions（老系统）或系统开了「减弱动态效果」：照常瞬间切换。
// ★电脑网页版（WEB_SURFACE，2026-09-30 goat：「整个页面全部滑走，看起来很不舒服」）不横推：
//   同一个栏目里换内容（现货换币种、换人主页等）整页不做动画，只让数据原地更新；
//   换栏目（顶部导航、个人中心里的我的资产 / 我的主页 / 设置）只做很短的淡入淡出，顶栏和底部状态栏原地不动（index.css data-nav="fade"）
// 返回时滚动位置照旧由 ScrollRestorer 在布局阶段恢复（flushSync 里同步执行），新页快照就是恢复后的位置。
import { flushSync } from 'react-dom'
import { UNSAFE_createBrowserHistory, UNSAFE_createHashHistory } from 'react-router-dom'
import { isNative } from './native'
import { WEB_SURFACE } from './surface'
import { CLEAN_URLS } from './route'

export type NavDir = 'forward' | 'back' | 'tab' | 'fade' | 'none'

/** 底部五个标签页的首页 */
export const TAB_ROOTS = new Set(['/', '/discover', '/community', '/live', '/settings'])

/** 返回按钮 / 返回手势在导航前告诉这里方向；1 秒内没有发生导航就作废，免得挂到后面不相干的一次跳转上 */
let hint: { dir: NavDir; at: number } | null = null
const HINT_MS = 1000
export function markNextNav(dir: NavDir, now = Date.now()) { hint = { dir, at: now } }
export function takeHint(now = Date.now()): NavDir | null {
  const h = hint
  hint = null
  return h && now - h.at < HINT_MS ? h.dir : null
}

export interface NavStep {
  from: string
  to: string
  action: string
  /** 浏览器前进后退时历史移动了几格（负数 = 后退），拿不到是 null */
  delta?: number | null
  hint?: NavDir | null
  /** 是不是原生 App */
  native: boolean
  /** 是不是手指操作的设备（手机浏览器） */
  coarse: boolean
}

/** 这一次导航该播哪种动画 */
export function navDirection(s: NavStep): NavDir {
  if (s.hint === 'none') return 'none'
  if (s.from === s.to) return 'none'
  const fromTab = TAB_ROOTS.has(s.from), toTab = TAB_ROOTS.has(s.to)
  // 返回按钮没有上一页时是「替换成上级页面」，也按返回播
  if (s.hint === 'back' || s.hint === 'forward') return fromTab && toTab ? 'tab' : s.hint
  if (s.action === 'POP') {
    if (fromTab && toTab) return 'tab'
    // 手机浏览器里用浏览器自己的边缘滑动 / 返回键后退：浏览器已经播过它的动画，不再叠一遍
    // （App 里的返回按钮会先 markNextNav('back')，走上面那条，不受影响）
    if (!s.native && s.coarse) return 'none'
    return (s.delta ?? -1) < 0 ? 'back' : 'forward'
  }
  if (s.action === 'REPLACE') return 'none'
  return toTab ? 'tab' : 'forward'
}

/** 网页版按栏目分组：现货列表和单个币的交易页算同一个栏目（换币种不整页切换） */
const WEB_GROUPS: Record<string, string> = { token: 'spot', spot: 'spot' }
const webSection = (path: string) => { const seg = path.split('/')[1] || ''; return WEB_GROUPS[seg] ?? seg }
/** 电脑网页版：把手机那套方向换成「同栏目不动 / 换栏目淡入淡出」 */
export function webNavDirection(from: string, to: string, base: NavDir): NavDir {
  if (base === 'none') return 'none'
  return webSection(from) === webSection(to) ? 'none' : 'fade'
}

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> }
type DocWithVT = Document & { startViewTransition?: (cb: () => void) => VT }

const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const coarsePointer = () => { try { return !!window.matchMedia?.('(pointer: coarse)').matches } catch { return false } }

let seq = 0
/** 按方向播放动画并在中间同步执行 update；不能播就直接 update。返回是否用了过渡 */
export function runWithTransition(dir: NavDir, update: () => void, doc: Document = document, reduced = reducedMotion): boolean {
  const d = doc as DocWithVT
  if (dir === 'none' || typeof d.startViewTransition !== 'function' || reduced()) { update(); return false }
  const root = doc.documentElement
  const token = String(++seq)
  root.dataset.nav = dir
  root.dataset.navSeq = token
  const done = () => { if (root.dataset.navSeq === token) { delete root.dataset.nav; delete root.dataset.navSeq } }
  let vt: VT
  try {
    vt = d.startViewTransition.call(doc, () => { flushSync(update) })
  } catch {
    done(); update(); return false
  }
  // 连点两次时前一个过渡会被新的顶掉（ready / finished 会 reject），吞掉，不当成错误
  vt.ready.catch(() => {})
  vt.updateCallbackDone.catch(() => {})
  vt.finished.then(done, done)
  return true
}

type HashHistory = ReturnType<typeof UNSAFE_createHashHistory>
type Update = { action: string; location: { pathname: string }; delta?: number | null }

/** 在历史对象上包一层：每次路由变化先判方向，再用过渡动画执行路由器自己的更新 */
export function withPageTransitions<H extends Pick<HashHistory, 'listen' | 'location'>>(history: H, env: { native: boolean; coarse: () => boolean; web?: boolean } = { native: isNative, coarse: coarsePointer, web: WEB_SURFACE }): H {
  const listen = history.listen.bind(history)
  let current = history.location.pathname
  history.listen = ((fn: (u: Update) => void) => listen((update: Update) => {
    const to = update.location.pathname
    const base = navDirection({ from: current, to, action: update.action, delta: update.delta, hint: takeHint(), native: env.native, coarse: env.coarse() })
    const dir = env.web ? webNavDirection(current, to, base) : base
    current = to
    runWithTransition(dir, () => fn(update))
  })) as H['listen']
  return history
}

/**
 * 整个 App 用的历史（main.tsx 交给 unstable_HistoryRouter），v5Compat 行为。
 * 电脑网页版是干净网址 420.meme/discover（2026-10-02，lib/route.ts）；手机网页版、原生 App 仍是 #/ 地址
 */
export function createAppHistory(): HashHistory {
  return withPageTransitions(CLEAN_URLS ? UNSAFE_createBrowserHistory({ window, v5Compat: true }) : UNSAFE_createHashHistory({ window, v5Compat: true }))
}
