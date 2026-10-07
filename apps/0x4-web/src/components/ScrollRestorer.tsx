// Global scroll restoration: going back lands where the page was left; newly entered pages start at the top.
// Rules and pure logic live in lib/scrollRestore.ts. This only handles: recording (listening to scrolls) and restoring (scrolling once content has grown).
// Scrollable regions inside a page (not whole-page scrolling) get remembered too when given data-scroll-key="name".
// Chat pages (group chat / DMs / live-room chat) are excluded: they manage scrolling themselves with "stick to bottom + scroll up to load earlier".
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { ScrollMemory, planScroll, restoreStep, RESTORE_TIMEOUT } from '@/lib/scrollRestore'

const STORE_KEY = '0x4.scrollPos'
/** Keep watching this long after restoring: small jumps from image / skeleton swaps get corrected back */
const SETTLE_MS = 400

const memory = (() => {
  try { return ScrollMemory.from(JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null')) } catch { return new ScrollMemory() }
})()
let persistTimer: ReturnType<typeof setTimeout> | null = null
const persistSoon = () => {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(memory.toJSON())) } catch { /* Failing to persist only affects post-reload restoration */ }
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
  /** Don't record while restoring (before content grows, the browser clamps the position to 0 — don't mistake that for user scrolling) */
  const restoring = useRef(false)

  useLayoutEffect(() => {
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual' } catch { /* Ignore */ }
  }, [])

  // Record: whole-page scrolling + regions with data-scroll-key. Listening on document at capture phase catches non-bubbling scroll events inside regions too
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

  // Entering a history entry: decide scroll-to-top / restore / leave-alone by navigation type. Done in the layout phase so the new page's first frame never flashes at a wrong position
  useLayoutEffect(() => {
    current.current = loc.key
    const plan = planScroll(navType, memory.get(loc.key))
    if (plan.mode === 'keep') return
    if (plan.mode === 'top') {
      window.scrollTo(0, 0)
      // When the same page component swaps params (post A → post B), the scroll region is reused — scroll back to top too
      document.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => { el.scrollTop = 0 })
      return
    }

    // Copy the target value first: the one in memory may change during restoration
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
      // Don't write back the position here: this cleanup fires while leaving the page, when scrollY already belongs to the new page
    }
    // The user started scrolling / tapped: yield immediately, never fight the user
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
