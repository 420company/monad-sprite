// Welcome / unlock page intro (2026-09-25 pixel edition, replacing the liquid-chrome serif; 2026-09-29 the cat head drops in instead).
//
// The background is the app-global liquid fluid (LiquidBackground); no separate backdrop here.
// Timeline (seconds; full version T, unlock page uses the shortened T_FAST):
//   logo   the cat head drops from above into place: spring easing (fast then slow, overshooting ~4% before settling), focusing from blurry-transparent to sharp at the same time;
//          At the landing moment a ring of soft light blooms underfoot, a few pixel grains drift apart, a faint ground shadow gathers in
//   text   the tagline's pixel cells fly in from below and the sides, landing staggered with a touch of bounce
//   sweep  a pixel light band sweeps diagonally; swept cells brighten in sequence
//   cta    the button / password box fades in, then the bottom note
//   After that: one or two cells blink sporadically every few seconds
// OS "reduce motion": draw the final state directly. Leaving the page or hiding it: freeze the frame.
// Play the full version only once per app launch (useIntroPlay): after backgrounding auto-locks and returning to the unlock page, the cat head and tagline start in place with just an overall fade — never replayed from the top.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { layoutPixelText } from './pixelFont'
import { PixelTitleRenderer, type IntroTimeline } from './pixelTitle'

export type Timeline = IntroTimeline

// 2026-09-25 goat: too fast — slow the whole thing down ~2x
// 2026-09-29: the cat head drops in 0.9s; the tagline starts flying in only after the cat head lands (layering: cat head → tagline → button)
export const T: Timeline = { logo: 0.2, logoDur: 0.9, text: 0.75, textEnd: 4.5, sweep: 4.6, sweepDur: 1.2, cta: 4.8, note: 5.1 }

/** Shortened version for the unlock page (returning users see it every launch): the cat head lands in 0.8s, the password box appears at 0.45s without waiting for the tagline to finish assembling */
export const T_FAST: Timeline = { logo: 0.05, logoDur: 0.8, text: 0.35, textEnd: 2.4, sweep: 2.5, sweepDur: 1.0, cta: 0.45, note: 0.65 }

/** Already fully played this app launch: cat head and tagline start in place, the button doesn't wait */
export const T_STILL: Timeline = { logo: 0, logoDur: 0, text: 0, textEnd: 0, sweep: 0, sweepDur: 0, cta: 0, note: 0 }

/** The button / note's CSS animation delay is read from here */
export const timelineFor = (tl: Timeline) => ({ '--t-cta': `${tl.cta}s`, '--t-note': `${tl.note}s` }) as CSSProperties

/** Whether the intro has fully played in this app session (kept in memory; cleared on cold start or page reload) */
let playedThisSession = false
/** For tests */
export function resetIntroSession() { playedThisSession = false }

/**
 * Whether this page should play the full intro: only the first time the welcome / unlock page is entered per app launch — after that (auto-locked from background, returning from onboarding) it starts in place;
 * the OS "reduce motion" setting never plays. Returns { play, tl }: tl is the timeline this page should use (T_STILL when not playing).
 * The initializer only reads, never writes (React dev mode calls it twice); the "already played" mark is written after mount.
 */
export function useIntroPlay(base: Timeline): { play: boolean; tl: Timeline } {
  const [play] = useState(() => !playedThisSession && !reducedMotion())
  useEffect(() => { playedThisSession = true }, [])
  return { play, tl: play ? base : T_STILL }
}

const LINES = ['MEME IS', 'EVERYTHING.']
const TEXT = layoutPixelText(LINES)

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const isLight = () => document.documentElement.dataset.theme === 'light'

/** Intro clock: shared by the cat head and tagline; timing starts at the first frame (a cold start's first frame may stall) */
function makeClock() {
  let t0: number | null = null
  return () => {
    const now = performance.now()
    if (t0 === null) t0 = now
    const t = (now - t0) / 1000
    // Diagnostic builds only: window.__introAt = <seconds> freezes the frame at a moment, handy for screenshots
    if (import.meta.env.VITE_DIAG === '1') { const f = (window as unknown as { __introAt?: number }).__introAt; if (typeof f === 'number') return f }
    return t
  }
}
/** In diagnostic builds, when __introAt freezes the frame, the loop keeps running — changing the moment repaints immediately */
const frozen = () => import.meta.env.VITE_DIAG === '1' && typeof (window as unknown as { __introAt?: number }).__introAt === 'number'
/** One clock per component instance; re-renders don't swap it */
const useIntroClock = () => useState(makeClock)[0]

/** Run the rAF loop while the page is visible; stop when loop returns false; call resume from the top when visible flips back */
function runWhileVisible(loop: () => boolean, cleanups: (() => void)[]) {
  let raf = 0
  const tick = () => { raf = loop() && !document.hidden ? requestAnimationFrame(tick) : 0 }
  const resume = () => { cancelAnimationFrame(raf); raf = document.hidden ? 0 : requestAnimationFrame(tick) }
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0 } else resume() }
  document.addEventListener('visibilitychange', onVis)
  cleanups.push(() => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) })
  return resume
}

/** Pixel particles kicked up from the bottom of the cat head on landing (like dust puffed up on touchdown): direction (degrees, 0 = right, negative = up), travel distance (px), color (four brand colors), size (px) */
const SPARKS: { a: number; d: number; c: number; s: number }[] = [
  { a: 194, d: 54, c: 1, s: 3 }, { a: 206, d: 40, c: 3, s: 2 }, { a: 176, d: 46, c: 2, s: 2 }, { a: 220, d: 30, c: 4, s: 2 },
  { a: 346, d: 54, c: 2, s: 3 }, { a: 334, d: 40, c: 4, s: 2 }, { a: 4, d: 46, c: 1, s: 2 }, { a: 320, d: 30, c: 3, s: 2 },
]

/**
 * Cat-head logo (public/icons/cat.svg — airplane ears and the slashed 0 are in the artwork).
 * play: drops in from above (springy, overshooting ~4% before settling) + focuses from blurry-transparent to sharp; on landing, a soft glow spreads behind it, a few pixel particles kick up from the ground on both sides, and the ground shadow tightens.
 * Only transform / opacity / filter move; when not playing it's already in place (the outer fade-in is the page's job).
 */
export function CatMark({ size = 76, tl = T, play = true }: { size?: number; tl?: Timeline; play?: boolean }) {
  const style = { width: size, height: size, '--cat-delay': `${tl.logo}s`, '--cat-dur': `${tl.logoDur}s` } as CSSProperties
  return (
    <span className={`welcome-cat${play ? ' is-dropping' : ''}`} style={style} aria-hidden="true" data-testid="welcome-cat">
      {play && <span className="welcome-cat-shadow" />}
      {play && <span className="welcome-cat-halo" />}
      {play && (
        <span className="welcome-cat-sparks">
          {SPARKS.map((p, k) => {
            const r = (p.a * Math.PI) / 180
            return <i key={k} style={{ '--dx': `${(Math.cos(r) * p.d).toFixed(1)}px`, '--dy': `${(Math.sin(r) * p.d).toFixed(1)}px`, '--c': `var(--sg-${p.c})`, '--s': `${p.s}px`, '--k': k } as CSSProperties} />
          })}
        </span>
      )}
      <img className="welcome-cat-img" src={`${import.meta.env.BASE_URL}icons/cat.svg`} alt="" width={size} height={size} />
    </span>
  )
}

/** Pixel tagline. The h1 holds real text for screen readers; the visual is drawn on canvas */
export function PixelTitle({ tl = T, still: stillProp = false }: { tl?: Timeline; still?: boolean }) {
  const h1 = useRef<HTMLHeadingElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const clock = useIntroClock()

  useLayoutEffect(() => {
    const el = h1.current, canvas = cv.current
    if (!el || !canvas) return
    const still = stillProp || reducedMotion()
    const r = new PixelTitleRenderer(canvas, TEXT, tl)
    r.setTheme(isLight())
    const cleanups: (() => void)[] = []
    const introEnd = tl.sweep + tl.sweepDur
    let idleAt = 0
    let nextTwinkle = introEnd + 1.5

    const layout = () => {
      const box = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const textH = (box.width / TEXT.cols) * TEXT.rows
      // Canvas extends to the screen edges horizontally, 1.6 tagline-heights extra below and 0.6 above, so flying-in blocks don't get clipped
      const pad = { left: box.left, right: Math.max(0, window.innerWidth - box.right), top: Math.round(textH * 0.6), bottom: Math.round(textH * 1.6) }
      const size = r.layout(box.width, dpr, pad)
      Object.assign(canvas.style, { left: `${-pad.left}px`, top: `${-pad.top}px`, width: `${size.width}px`, height: `${size.height}px` })
      paint()
    }
    const paint = () => { const t = clock(); r.draw(still ? introEnd : t, still) }

    const loop = () => {
      const t = clock()
      if (t < introEnd + 0.1 || frozen()) { r.draw(t); return true }
      // Idle: colors flow cell-by-cell in jumps — 12 fps is enough (the jumps are stepped anyway), no need to burn battery at 60 fps; full speed while blinking
      if (t >= nextTwinkle) { r.twinkle(t, Math.random() < 0.4 ? 2 : 1); nextTwinkle = t + 2.5 + Math.random() * 3 }
      const busy = r.busy(t)
      r.draw(t)
      if (!busy) {
        window.clearTimeout(idleAt)
        idleAt = window.setTimeout(resume, 83)
        return false
      }
      return true
    }
    const resume = runWhileVisible(loop, cleanups)
    cleanups.push(() => window.clearTimeout(idleAt))

    layout()
    if (!still) resume()

    const ro = new ResizeObserver(layout)
    ro.observe(el)
    cleanups.push(() => ro.disconnect())
    const onTheme = () => { r.setTheme(isLight()); paint() }
    window.addEventListener('theme-change', onTheme)
    cleanups.push(() => window.removeEventListener('theme-change', onTheme))
    return () => cleanups.forEach(f => f())
  }, [tl, clock, stillProp])

  return (
    <h1 ref={h1} className="welcome-title" style={{ aspectRatio: `${TEXT.cols} / ${TEXT.rows}` }} aria-label="Meme is everything.">
      <span className="sr-only">Meme is everything.</span>
      <canvas ref={cv} aria-hidden="true" />
    </h1>
  )
}
