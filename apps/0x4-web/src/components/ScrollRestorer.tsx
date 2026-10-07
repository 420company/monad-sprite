// 全局滚动恢复：后退回到一个页面时，停在离开时的位置；新进入的页面从顶部开始。
// 规则和纯逻辑在 lib/scrollRestore.ts。这里只负责：记录（监听滚动）、恢复（等内容长出来再滚过去）。
// 页面里自己滚动的区域（不是整页滚）加 data-scroll-key="名字" 就会一起记住。
// 聊天页（群聊 / 私信 / 直播间聊天）不加：它们按「贴底 + 往上翻加载更早」自己管滚动。
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { ScrollMemory, planScroll, restoreStep, RESTORE_TIMEOUT } from '@/lib/scrollRestore'

const STORE_KEY = '0x4.scrollPos'
/** 恢复到位后再盯这么久：图片 / 骨架替换引起的小幅跳动再纠正回来 */
const SETTLE_MS = 400

const memory = (() => {
  try { return ScrollMemory.from(JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null')) } catch { return new ScrollMemory() }
})()
let persistTimer: ReturnType<typeof setTimeout> | null = null
const persistSoon = () => {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(memory.toJSON())) } catch { /* 存不进去只影响重载后的恢复 */ }
  }, 300)
}

const windowMax = () => {
  const el = document.scrollingElement || document.documentElement
  return el.scrollHeight - window.innerHeight
}
const areaEl = (name: string) => document.querySelector<HTMLElement>(`[data-scroll-key="${CSS.escape(name)}"]`)

export default function ScrollRestorer() {
  const loc = useLocation()
  const navType = useNavigationType()
  const current = useRef(loc.key)
  /** 正在恢复时不记录（内容还没长出来时浏览器会把位置夹到 0，别把它当成用户滚的） */
  const restoring = useRef(false)

  useLayoutEffect(() => {
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual' } catch { /* 忽略 */ }
  }, [])

  // 记录：整页滚动 + 带 data-scroll-key 的区域。捕获阶段监听 document，区域里的滚动事件不冒泡也能收到
  useEffect(() => {
    const onScroll = (e: Event) => {
      if (restoring.current) return
      const key = current.current
      const tgt = e.target
      if (tgt === document || tgt === document.documentElement || tgt === document.body) memory.saveWindow(key, window.scrollY)
      else if (tgt instanceof HTMLElement && tgt.dataset.scrollKey) memory.saveArea(key, tgt.dataset.scrollKey, tgt.scrollTop)
      else return
      persistSoon()
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  // 进到一条历史记录：按导航类型决定回顶部 / 恢复 / 不动。布局阶段就做，新页面第一帧不会先闪一下别的位置
  useLayoutEffect(() => {
    current.current = loc.key
    const plan = planScroll(navType, memory.get(loc.key))
    if (plan.mode === 'keep') return
    if (plan.mode === 'top') {
      window.scrollTo(0, 0)
      // 同一个页面组件换了参数（帖子 A → 帖子 B）时滚动区是复用的，也要回到顶部
      document.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => { el.scrollTop = 0 })
      return
    }

    // 目标值先拷出来：恢复期间 memory 里那份可能被改
    const targets: { area: string | null; top: number; done: boolean }[] = [
      { area: null, top: plan.entry.y, done: false },
      ...Object.entries(plan.entry.areas).map(([area, top]) => ({ area, top, done: false })),
    ]
    let cancelled = false
    let raf = 0
    let settledAt = 0
    const start = performance.now()
    restoring.current = true
    const stop = () => {
      if (cancelled) return
      cancelled = true
      cancelAnimationFrame(raf)
      restoring.current = false
      window.removeEventListener('touchstart', stop, true)
      window.removeEventListener('wheel', stop, true)
      window.removeEventListener('keydown', stop, true)
      // 这里不回写位置：离开页面时触发的清理，此刻的 scrollY 已经是新页面的了
    }
    // 用户自己开始滚 / 点了：立刻让位，不跟用户抢
    window.addEventListener('touchstart', stop, true)
    window.addEventListener('wheel', stop, true)
    window.addEventListener('keydown', stop, true)

    const frame = () => {
      if (cancelled) return
      const now = performance.now()
      const elapsed = now - start
      let pending = false
      for (const tg of targets) {
        const el = tg.area === null ? null : areaEl(tg.area)
        if (tg.area !== null && !el) { if (elapsed < RESTORE_TIMEOUT) pending = true; continue }
        const max = el ? el.scrollHeight - el.clientHeight : windowMax()
        const cur = el ? el.scrollTop : window.scrollY
        const step = restoreStep(tg.top, max, elapsed)
        if (step === 'wait') { pending = true; continue }
        const want = Math.min(tg.top, Math.max(0, max))
        if (Math.abs(cur - want) > 1) { if (el) el.scrollTop = want; else window.scrollTo(0, want) }
        tg.done = true
      }
      if (pending) { raf = requestAnimationFrame(frame); return }
      if (!settledAt) settledAt = now
      if (now - settledAt < SETTLE_MS) { raf = requestAnimationFrame(frame); return }
      stop()
    }
    frame()
    return stop
  }, [loc.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
