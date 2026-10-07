// 像素标语的绘制（canvas 2D，每个像素方块一个粒子）。组件在 WelcomeIntro.tsx。
//
// 画布比标语大一圈（左右到屏幕边、上下各多出一段），方块从下方和两侧飞进来。
// 方块尺寸取整到设备像素、位置也取整，关掉插值，保证边缘锐利。
import type { PixelText } from './pixelFont'

export interface IntroTimeline {
  /** 猫头像素化显影开始 / 时长 */
  logo: number
  logoDur: number
  /** 第一颗方块起飞 / 最后一颗落位 */
  text: number
  textEnd: number
  /** 光带扫过开始 / 时长 */
  sweep: number
  sweepDur: number
  /** 按钮（解锁页是密码框）、底部说明淡入 */
  cta: number
  note: number
}

interface Particle {
  x: number
  y: number
  delay: number
  dur: number
  /** 起飞点相对落点的偏移：横向按标语宽度算、纵向按标语高度算 */
  fx: number
  fy: number
  /** 沿对角线的位置 0–1：光带和配色都用它 */
  u: number
  /** 落位后上 / 下 / 左 / 右是不是字形边缘（边缘才画高光和暗边，字里面连成一整块） */
  edge: [boolean, boolean, boolean, boolean]
}

interface Palette {
  face: string
  hi: string
  lo: string
  shadow: string
  /** 被光带扫到时的颜色（按强度分三档） */
  lit: string[]
  glow: string | null
  seam: string
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
/** 带一点回弹 */
const easeOutBack = (x: number, s = 1.35) => { const t = clamp(x) - 1; return 1 + (s + 1) * t * t * t + s * t * t }

// 伪随机：同一段字每次排出来一样（录屏、截图可复现）
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
}

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: RGB, b: RGB, k: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(' ')})`

// 深色流体上：近白厚重字，光带扫过变纯白、带一圈淡紫柔光；浅色流体上：近黑字，光带扫过变品牌紫
function palette(light: boolean): Palette {
  if (light) {
    const face = hex('#17181f'), lit = hex('#6b4de6')
    return { face: '#17181f', hi: 'rgb(255 255 255 / .16)', lo: 'rgb(0 0 0 / .35)', shadow: 'rgb(44 34 110 / .24)', lit: [1, 2, 3].map(k => mix(face, lit, k / 3)), glow: null, seam: 'rgb(255 255 255 / .06)' }
  }
  const face = hex('#ebe7f0'), lit = hex('#ffffff')
  return { face: '#ebe7f0', hi: 'rgb(255 255 255 / .7)', lo: 'rgb(60 50 90 / .22)', shadow: 'rgb(6 6 18 / .42)', lit: [1, 2, 3].map(k => mix(face, lit, k / 3)), glow: 'rgb(214 200 255 / .26)', seam: 'rgb(70 60 100 / .1)' }
}

// 色彩流动（2026-09-25 goat：字要有色彩上的动效）：品牌三色 蜜桃 → 淡紫 → 冰青 斜着缓慢流过整块字，
// 分成 FLOW_STEPS 档，一格一格跳色，保持像素风；深色流体上用浅色调（和白字混一半），浅色流体上用深色调，保证看得清
const FLOW_STEPS = 12
const FLOW_PERIOD = 7 // 秒，流过一整轮
function flowColors(light: boolean): string[] {
  const stops: RGB[] = light ? [hex('#c2415f'), hex('#5b3fd6'), hex('#10789c')] : [hex('#ffb08f'), hex('#c7a8ff'), hex('#8fdcff')]
  const base = light ? hex('#17181f') : hex('#ffffff')
  const k = light ? 0.15 : 0.08 // 往底色拉一点点，保留色彩又不刺眼
  return Array.from({ length: FLOW_STEPS }, (_, i) => {
    const f = (i / FLOW_STEPS) * stops.length
    const a = stops[Math.floor(f) % stops.length], b = stops[(Math.floor(f) + 1) % stops.length]
    const c = a.map((v, j) => v + (b[j] - v) * (f % 1)) as RGB
    return mix(c, base, k)
  })
}

export class PixelTitleRenderer {
  private ctx: CanvasRenderingContext2D
  private parts: Particle[]
  private cell = 1
  /** 标语左上角在画布里的位置（设备像素） */
  private ox = 0
  private oy = 0
  private pal: Palette
  private flow: string[] = flowColors(false)
  /** 闲置时零星闪一下的方块：下标 → 开始时间 */
  private twinkles = new Map<number, number>()

  constructor(private canvas: HTMLCanvasElement, private text: PixelText, private tl: IntroTimeline) {
    this.ctx = canvas.getContext('2d')!
    this.pal = palette(false)
    const r = rng(0x4204)
    const spread = tl.textEnd - tl.text
    const filled = new Set(text.cells.map(c => `${c.x},${c.y}`))
    const has = (x: number, y: number) => filled.has(`${x},${y}`)
    this.parts = text.cells.map(c => {
      const dur = clamp(spread * 0.34, 0.42, 0.8) * (0.85 + r() * 0.3)
      // 大致从左往右、先第一行后第二行落位，再撒一把随机让它错落
      const k = clamp(0.5 * (c.x / text.cols) + 0.15 * c.line + 0.35 * r())
      const fromBelow = r() < 0.6
      const side = r() < 0.5 ? -1 : 1
      return {
        x: c.x, y: c.y, dur,
        delay: tl.text + k * Math.max(0, spread - dur),
        fx: fromBelow ? (r() - 0.5) * 0.5 : side * (0.35 + r() * 0.4),
        fy: fromBelow ? 0.9 + r() * 1.1 : (r() - 0.6) * 1.4,
        u: (c.x + (text.rows - c.y) * 0.55) / (text.cols + text.rows * 0.55),
        edge: [!has(c.x, c.y - 1), !has(c.x, c.y + 1), !has(c.x - 1, c.y), !has(c.x + 1, c.y)],
      }
    })
  }

  setTheme(light: boolean) { this.pal = palette(light); this.flow = flowColors(light) }

  /**
   * 按标语占位宽度排版：方块边长 = 占位宽度 ÷ 列数，向下取整到设备像素。
   * pad = 画布在标语四周多铺出去的 CSS 像素（给飞入留地方）。返回画布的 CSS 尺寸
   */
  layout(boxW: number, dpr: number, pad: { left: number; right: number; top: number; bottom: number }) {
    const { cols, rows } = this.text
    this.cell = Math.max(1, Math.floor((boxW * dpr) / cols))
    const W = Math.round((pad.left + pad.right) * dpr) + cols * this.cell
    const H = Math.round((pad.top + pad.bottom) * dpr) + rows * this.cell
    this.ox = Math.round(pad.left * dpr)
    this.oy = Math.round(pad.top * dpr)
    this.canvas.width = W
    this.canvas.height = H
    return { width: W / dpr, height: H / dpr }
  }

  /** 闲置阶段：挑几颗方块闪一下 */
  twinkle(now: number, n: number) {
    for (let i = 0; i < n; i++) this.twinkles.set(Math.floor(Math.random() * this.parts.length), now + i * 0.18)
  }

  /** 闲置阶段有没有正在闪的方块（没有就不用继续跑帧） */
  busy(now: number) {
    for (const [i, t0] of this.twinkles) if (now - t0 > 0.6) this.twinkles.delete(i)
    return this.twinkles.size > 0
  }

  /** t = 开场后的秒数；still = 直接画最终态 */
  draw(t: number, still = false) {
    const { ctx, cell, pal, ox, oy, tl } = this
    const tw = this.text.cols * cell, th = this.text.rows * cell
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.imageSmoothingEnabled = false
    const e = Math.max(1, Math.round(cell * 0.13))
    const sd = Math.max(1, Math.round(cell * 0.2))
    const sweepC = still ? -9 : -0.25 + ((t - tl.sweep) / tl.sweepDur) * 1.5

    // 先算每颗方块这一帧的位置 / 大小 / 透明度 / 亮度，阴影一遍、方块一遍，阴影不会压到相邻方块上
    // [x, y, 边长, 透明度, 亮度档, 粒子下标, 是否已落位]
    const frame: [number, number, number, number, number, number, boolean][] = []
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]
      const k = still ? 1 : (t - p.delay) / p.dur
      if (k <= 0) continue
      const m = easeOutBack(k)
      const size = Math.max(1, Math.round(cell * (0.45 + 0.55 * easeOut(k * 1.6))))
      const x = ox + p.x * cell + Math.round((1 - m) * p.fx * tw) + ((cell - size) >> 1)
      const y = oy + p.y * cell + Math.round((1 - m) * p.fy * th) + ((cell - size) >> 1)
      const a = clamp(k * 4)
      // 光带：窄带斜着扫过，强度分三档，像素风不要平滑渐变
      let lit = 0
      const d = Math.abs(p.u - sweepC)
      if (d < 0.13) lit = Math.ceil((1 - d / 0.13) * 3)
      const tw0 = this.twinkles.get(i)
      if (tw0 !== undefined && t >= tw0) {
        const s = (t - tw0) / 0.6
        if (s < 1) lit = Math.max(lit, [1, 2, 3, 3, 2, 1][Math.floor(s * 6)])
      }
      frame.push([x, y, size, a, lit, i, k >= 1])
    }

    ctx.fillStyle = pal.shadow
    for (const [x, y, size, a] of frame) { ctx.globalAlpha = a; ctx.fillRect(x + sd, y + sd, size, size) }
    if (pal.glow) {
      ctx.fillStyle = pal.glow
      for (const [x, y, size, a, lit] of frame) {
        if (lit < 2) continue
        const g = Math.round(cell * (lit === 3 ? 0.4 : 0.2))
        ctx.globalAlpha = a
        ctx.fillRect(x - g, y - g, size + g * 2, size + g * 2)
      }
    }
    for (const [x, y, size, a, lit, i, landed] of frame) {
      ctx.globalAlpha = a
      // 没被光带扫到时按位置和时间取流动色；光带和闪烁照旧提亮
      const ph = ((this.parts[i].u * 1.2 - t / FLOW_PERIOD) % 1 + 1) % 1
      ctx.fillStyle = lit ? pal.lit[lit - 1] : this.flow[Math.floor(ph * FLOW_STEPS) % FLOW_STEPS]
      ctx.fillRect(x, y, size, size)
      if (size < 4) continue
      // 飞行中是独立小方块，四边都有高光暗边；落位后只在字形外缘画，字身连成厚实的一整块
      const [top, bottom, left, right] = landed ? this.parts[i].edge : [true, true, true, true]
      ctx.fillStyle = pal.hi
      if (top) ctx.fillRect(x, y, size, e)
      if (left) ctx.fillRect(x, y, e, size)
      ctx.fillStyle = pal.lo
      if (bottom) ctx.fillRect(x, y + size - e, size, e)
      if (right) ctx.fillRect(x + size - e, y, e, size)
      // 格缝：极淡的一像素线，留住「一颗颗像素」的质感
      ctx.fillStyle = pal.seam
      if (!bottom) ctx.fillRect(x, y + size - 1, size, 1)
      if (!right) ctx.fillRect(x + size - 1, y, 1, size)
    }
    ctx.globalAlpha = 1
  }
}
