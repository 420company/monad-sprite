// Pixel tagline rendering (canvas 2D, one particle per pixel cell). The component lives in WelcomeIntro.tsx.
//
// The canvas is a ring larger than the tagline (sides to the screen edges, extra above and below); cells fly in from below and the sides.
// Cell sizes floored to device pixels, positions floored too, interpolation off — edges stay crisp.
import type { PixelText } from './pixelFont'

export interface IntroTimeline {
  /** Cat-head pixelation develop start / duration */
  logo: number
  logoDur: number
  /** First cell takes off / last cell lands */
  text: number
  textEnd: number
  /** Light band sweep start / duration */
  sweep: number
  sweepDur: number
  /** The button (password box on the unlock page) and the bottom note fade in */
  cta: number
  note: number
}

interface Particle {
  x: number
  y: number
  delay: number
  dur: number
  /** Takeoff point offset relative to the landing point: horizontal from tagline width, vertical from tagline height */
  fx: number
  fy: number
  /** Position 0–1 along the diagonal: both the light band and the palette use it */
  u: number
  /** After landing, whether up / down / left / right is a glyph edge (highlights and dark edges only on edges; interiors merge into one block) */
  edge: [boolean, boolean, boolean, boolean]
}

interface Palette {
  face: string
  hi: string
  lo: string
  shadow: string
  /** The color when swept by the light band (three steps by intensity) */
  lit: string[]
  glow: string | null
  seam: string
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
/** With a touch of bounce */
const easeOutBack = (x: number, s = 1.35) => { const t = clamp(x) - 1; return 1 + (s + 1) * t * t * t + s * t * t }

// Pseudo-random: the same text lays out identically every time (screen recordings and screenshots are reproducible)
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
}

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: RGB, b: RGB, k: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(' ')})`

// On dark fluid: near-white heavy type, turning pure white with a soft lavender glow as the light band sweeps; on light fluid: near-black type, turning brand purple under the band
function palette(light: boolean): Palette {
  if (light) {
    const face = hex('#17181f'), lit = hex('#6b4de6')
    return { face: '#17181f', hi: 'rgb(255 255 255 / .16)', lo: 'rgb(0 0 0 / .35)', shadow: 'rgb(44 34 110 / .24)', lit: [1, 2, 3].map(k => mix(face, lit, k / 3)), glow: null, seam: 'rgb(255 255 255 / .06)' }
  }
  const face = hex('#ebe7f0'), lit = hex('#ffffff')
  return { face: '#ebe7f0', hi: 'rgb(255 255 255 / .7)', lo: 'rgb(60 50 90 / .22)', shadow: 'rgb(6 6 18 / .42)', lit: [1, 2, 3].map(k => mix(face, lit, k / 3)), glow: 'rgb(214 200 255 / .26)', seam: 'rgb(70 60 100 / .1)' }
}

// Flowing colors (2026-09-25 goat: the text needs color motion): the three brand colors — peach → lavender → ice cyan — drift diagonally and slowly across the whole glyph block,
// Split into FLOW_STEPS steps, jumping color cell by cell to keep the pixel look; light tones on dark fluid (mixed half with the white text), dark tones on light fluid — always readable
const FLOW_STEPS = 12
const FLOW_PERIOD = 7 // Seconds for one full flow cycle
function flowColors(light: boolean): string[] {
  const stops: RGB[] = light ? [hex('#c2415f'), hex('#5b3fd6'), hex('#10789c')] : [hex('#ffb08f'), hex('#c7a8ff'), hex('#8fdcff')]
  const base = light ? hex('#17181f') : hex('#ffffff')
  const k = light ? 0.15 : 0.08 // Pull slightly toward the base color — keeps the hue without glaring
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
  /** The tagline's top-left position on the canvas (device pixels) */
  private ox = 0
  private oy = 0
  private pal: Palette
  private flow: string[] = flowColors(false)
  /** Cells that blink sporadically while idle: index → start time */
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
      // Land roughly left-to-right, first row then second, then scatter some randomness for stagger
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
   * Lay out to the tagline placeholder width: cell side = placeholder width ÷ columns, floored to device pixels.
   * pad = extra CSS pixels the canvas extends beyond the tagline on all sides (room for the fly-in). Returns the canvas's CSS size
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

  /** Idle phase: pick a few cells to blink */
  twinkle(now: number, n: number) {
    for (let i = 0; i < n; i++) this.twinkles.set(Math.floor(Math.random() * this.parts.length), now + i * 0.18)
  }

  /** Whether any cell is blinking during idle (if none, no need to keep running frames) */
  busy(now: number) {
    for (const [i, t0] of this.twinkles) if (now - t0 > 0.6) this.twinkles.delete(i)
    return this.twinkles.size > 0
  }

  /** t = seconds since the intro started; still = draw the final state directly */
  draw(t: number, still = false) {
    const { ctx, cell, pal, ox, oy, tl } = this
    const tw = this.text.cols * cell, th = this.text.rows * cell
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.imageSmoothingEnabled = false
    const e = Math.max(1, Math.round(cell * 0.13))
    const sd = Math.max(1, Math.round(cell * 0.2))
    const sweepC = still ? -9 : -0.25 + ((t - tl.sweep) / tl.sweepDur) * 1.5

    // First compute each cell's position / size / opacity / brightness for this frame — one pass for shadows, one for cells, so shadows never cover neighboring cells
    // [x, y, side length, opacity, brightness step, particle index, landed?]
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
      // Light band: a narrow band sweeping diagonally, three intensity steps — pixel style, no smooth gradients
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
      // Unswept cells take the flowing color by position and time; the light band and blinking still brighten
      const ph = ((this.parts[i].u * 1.2 - t / FLOW_PERIOD) % 1 + 1) % 1
      ctx.fillStyle = lit ? pal.lit[lit - 1] : this.flow[Math.floor(ph * FLOW_STEPS) % FLOW_STEPS]
      ctx.fillRect(x, y, size, size)
      if (size < 4) continue
      // Mid-flight they're independent little cells with highlight and shadow on all four sides; once landed, only the glyph's outer edge is drawn, the body merging into one solid chunk
      const [top, bottom, left, right] = landed ? this.parts[i].edge : [true, true, true, true]
      ctx.fillStyle = pal.hi
      if (top) ctx.fillRect(x, y, size, e)
      if (left) ctx.fillRect(x, y, e, size)
      ctx.fillStyle = pal.lo
      if (bottom) ctx.fillRect(x, y + size - e, size, e)
      if (right) ctx.fillRect(x + size - e, y, e, size)
      // Cell gaps: an extremely faint one-pixel line, keeping the "individual pixels" texture
      ctx.fillStyle = pal.seam
      if (!bottom) ctx.fillRect(x, y + size - 1, size, 1)
      if (!right) ctx.fillRect(x + size - 1, y, 1, size)
    }
    ctx.globalAlpha = 1
  }
}
