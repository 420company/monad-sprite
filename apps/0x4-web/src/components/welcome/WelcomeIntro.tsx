// 欢迎页 / 解锁页开场（2026-09-25 像素版，替换液态铬衬线字；2026-09-29 猫头改成落下入场）。
//
// 背景就是 App 全局的液态流体（LiquidBackground），这里不另铺底。
// 时间线（秒，完整版 T；解锁页用缩短版 T_FAST）：
//   logo   猫头从上方落到位置上：弹性缓动（先快后慢、冲过头约 4% 再回稳），同时由模糊透明对焦到清晰；
//          落定那一刻脚下一圈柔光扩开、几颗像素颗粒轻轻散开，地面一道淡影收拢
//   text   标语的像素方块从下方和两侧飞进来，错落落位、带一点回弹
//   sweep  一道像素光带斜着扫过，扫到的方块依次提亮
//   cta    按钮 / 密码框淡入，之后底部说明
//   之后   每隔几秒零星一两颗方块闪一下
// 系统「减少动态效果」：直接画最终态。离开页面或页面隐藏：停帧。
// 同一次打开 App 里只完整播一次（useIntroPlay）：切到后台自动锁定、再回到解锁页，猫头和标语直接在位，只整体淡入，不再从头演一遍。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { layoutPixelText } from './pixelFont'
import { PixelTitleRenderer, type IntroTimeline } from './pixelTitle'

export type Timeline = IntroTimeline

// 2026-09-25 goat：太快，整体放慢约一倍
// 2026-09-29：猫头落下 0.9 秒，标语在猫头落定后才开始飞入（层次：猫头 → 标语 → 按钮）
export const T: Timeline = { logo: 0.2, logoDur: 0.9, text: 0.75, textEnd: 4.5, sweep: 4.6, sweepDur: 1.2, cta: 4.8, note: 5.1 }

/** 解锁页用的缩短版（老用户每次打开都看到）：猫头 0.8 秒落定，密码框 0.45 秒就出现、不等标语拼完 */
export const T_FAST: Timeline = { logo: 0.05, logoDur: 0.8, text: 0.35, textEnd: 2.4, sweep: 2.5, sweepDur: 1.0, cta: 0.45, note: 0.65 }

/** 本次打开 App 里已经完整播过：猫头、标语直接在位，按钮不再等 */
export const T_STILL: Timeline = { logo: 0, logoDur: 0, text: 0, textEnd: 0, sweep: 0, sweepDur: 0, cta: 0, note: 0 }

/** 按钮 / 说明的 CSS 动画延迟从这里读 */
export const timelineFor = (tl: Timeline) => ({ '--t-cta': `${tl.cta}s`, '--t-note': `${tl.note}s` }) as CSSProperties

/** 本次打开 App 里开场是否已经完整播过（内存里记，冷启动、重新加载页面会清掉） */
let playedThisSession = false
/** 测试用 */
export function resetIntroSession() { playedThisSession = false }

/**
 * 这一页要不要完整播开场：本次打开 App 第一次进欢迎页 / 解锁页才播，之后（切到后台被自动锁定、从引导页返回）直接在位；
 * 系统「减少动态效果」一律不播。返回 { play, tl }：tl 是这页该用的时间线（不播时用 T_STILL）。
 * 初始化函数只读不写（React 开发模式会调两次），播过的标记在挂载后才写。
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

/** 开场时钟：猫头和标语共用，第一帧时才开始计时（冷启动首帧可能被卡住） */
function makeClock() {
  let t0: number | null = null
  return () => {
    const now = performance.now()
    if (t0 === null) t0 = now
    const t = (now - t0) / 1000
    // 仅诊断构建：window.__introAt = 秒数 把画面定格在某一时刻，方便截图
    if (import.meta.env.VITE_DIAG === '1') { const f = (window as unknown as { __introAt?: number }).__introAt; if (typeof f === 'number') return f }
    return t
  }
}
/** 诊断构建里画面被 __introAt 定格时，循环一直跑，改时刻立刻重画 */
const frozen = () => import.meta.env.VITE_DIAG === '1' && typeof (window as unknown as { __introAt?: number }).__introAt === 'number'
/** 每个组件实例一只时钟，重渲染不换 */
const useIntroClock = () => useState(makeClock)[0]

/** 页面可见时跑 rAF 循环，loop 返回 false 就停；visible 变回来再从头调 resume */
function runWhileVisible(loop: () => boolean, cleanups: (() => void)[]) {
  let raf = 0
  const tick = () => { raf = loop() && !document.hidden ? requestAnimationFrame(tick) : 0 }
  const resume = () => { cancelAnimationFrame(raf); raf = document.hidden ? 0 : requestAnimationFrame(tick) }
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0 } else resume() }
  document.addEventListener('visibilitychange', onVis)
  cleanups.push(() => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) })
  return resume
}

/** 落定时从猫头底部向两侧扬起的像素颗粒（像落地带起的一点尘）：方向（度，0 = 向右、负向上）、飞出距离（px）、颜色（品牌四色）、大小（px） */
const SPARKS: { a: number; d: number; c: number; s: number }[] = [
  { a: 194, d: 54, c: 1, s: 3 }, { a: 206, d: 40, c: 3, s: 2 }, { a: 176, d: 46, c: 2, s: 2 }, { a: 220, d: 30, c: 4, s: 2 },
  { a: 346, d: 54, c: 2, s: 3 }, { a: 334, d: 40, c: 4, s: 2 }, { a: 4, d: 46, c: 1, s: 2 }, { a: 320, d: 30, c: 3, s: 2 },
]

/**
 * 猫头 logo（public/icons/cat.svg，飞机耳、0 带斜线都在原图里）。
 * play：从上方落下（弹性，冲过头约 4% 再回稳）+ 由模糊透明对焦到清晰；落定时背后柔光散开、底部向两侧扬起几颗像素颗粒、地面淡影收拢。
 * 只动 transform / opacity / filter；不播时直接在位（外层整体淡入由页面负责）。
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

/** 像素标语。h1 里放真实文字给读屏，画面画在 canvas 上 */
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
      // 画布往左右铺到屏幕边，往下多铺 1.6 个标语高、往上 0.6 个，飞入的方块才不会被切掉
      const pad = { left: box.left, right: Math.max(0, window.innerWidth - box.right), top: Math.round(textH * 0.6), bottom: Math.round(textH * 1.6) }
      const size = r.layout(box.width, dpr, pad)
      Object.assign(canvas.style, { left: `${-pad.left}px`, top: `${-pad.top}px`, width: `${size.width}px`, height: `${size.height}px` })
      paint()
    }
    const paint = () => { const t = clock(); r.draw(still ? introEnd : t, still) }

    const loop = () => {
      const t = clock()
      if (t < introEnd + 0.1 || frozen()) { r.draw(t); return true }
      // 闲置：颜色一格一格跳着流动，12 帧/秒就够（跳色本身是分档的），不用 60 帧空耗电；闪烁期间全速
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
