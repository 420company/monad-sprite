// Global liquid-fluid background (2026-09-25 0x4 redesign).
//
// Four large soft glows drift slowly (CSS animation); colors re-roll every 7s with a 5s crossfade.
//
// ⚠️ Rendering history (every version was changed only after breaking on real devices — read before touching):
//   1. Earliest: @property-registered color vars + transitions on :root. WebKit had crash bugs animating registered properties,
//      and every 7s forced every element using color vars to recompute.
//   2. 09-25: each glow was a solid block (background-color transition) + mask radial-gradient for soft edges. Glows were 85–95vmax each,
//      ~2900×2900px layers on 3x screens (~30MB each); 100MB+ for four got the web process killed by iOS for memory,
//      making the app look like it "refreshed itself". So elements shrank to 1/3 size + transform: scale(3).
//   3. 09-26 (current): goat reported "screen stutters and flashes when the background changes color". Cause: background-color transitions aren't compositor animations,
//      all four glows (plus their mask layers) were repainted and re-uploaded every frame for 5s; the frosted glass above
//      so the frosted glass above (.glass / .app-nav / .nav-floor backdrop-filters) recomputed every frame too — dropped frames, flashing.
//
// Current approach:
//   - Each glow's "shape" is painted on a tiny 128×128 canvas (radial gradient, alpha baked in), scaled up by CSS.
//     A canvas layer's VRAM depends only on its own pixels, not its display size or device pixel ratio: 128×128×4 = 64KB.
//     Glows are smooth gradients anyway, so upscaling shows no grain.
//   - Each glow holds two canvases (A / B) that crossfade: the new color is painted onto the hidden one first (instant,
//     no transition), then opacity flips (compositor animation — no repaint, no bitmap upload). One color change paints two 64KB images, only at flip time.
//   - VRAM estimate: 4 glows × 2 images × 64KB = 512KB per glow layer; global background + a few sheet layers ≈ 1–2MB.
//     vs version 2 (four 1/3-size color blocks + their mask layers ≈ 17MB on 3x screens, more if WebKit rasterizes at the scaled-up ratio)
//     — a huge drop. The outer .liquid-blob only drifts (transform animation); it paints nothing, holds no bitmap.
//   - The outer layer no longer sets opacity (parent opacity + child layers cost an extra offscreen composite per frame); alpha is baked into the gradient.
//   - Color changes bypass React: the module paints the canvas and flips data-face directly, triggering zero re-renders.
// Colors live in a module-level palette; sheets and the call UI render the same glow set via <LiquidLayer />, changing with the background.
// With the OS "reduce motion" on: no drift, no color changes; clicks pass through.
import { useLayoutEffect, useRef } from 'react'
import { currentTheme } from '@/lib/theme'

/**
 * Only pick from good-looking families: peach, rose, purple, indigo, ice-cyan, teal.
 * Yellow-greens (~50°–150°) look muddy on dark backgrounds in practice — excluded from candidates.
 * Shuffle and take four, then jitter each ±12°.
 */
const HUES = [20, 340, 290, 262, 228, 196, 176]
type Hsl = [number, number, number]

function palette(): Hsl[] {
  const pool = [...HUES].sort(() => Math.random() - 0.5).slice(0, 4)
  return pool.map((h, i) => {
    const hue = Math.round((h + Math.random() * 24 - 12 + 360) % 360)
    // Dark: medium saturation, lowered brightness — ambience only, never competes with content; light: pastels, brightness up
    const pale = currentTheme() === 'light'
    const sat = (pale ? 70 : 55) + Math.round(Math.random() * 20)
    const light = pale ? 78 + Math.round(Math.random() * 7) : i === 0 ? 46 : 40 + Math.round(Math.random() * 8)
    return [hue, sat, light]
  })
}

/** Center opacity per glow (used to live on CSS opacity: .55 dark / .4 for the fourth, .75 across the board in light) */
function alphaOf(i: number): number {
  if (currentTheme() === 'light') return 0.75
  return i === 3 ? 0.4 : 0.55
}

const SIZE = 128
const hsla = ([h, s, l]: Hsl, a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`

/** Paint one soft glow on canvas: solid center → fully transparent edge (equivalent to the old mask radial-gradient(closest-side, #000, transparent)) */
function paint(canvas: HTMLCanvasElement, color: Hsl, alpha: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const r = SIZE / 2
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  // Same hue at both ends, only alpha changes — keeps the mid-transition from going gray
  g.addColorStop(0, hsla(color, alpha))
  g.addColorStop(1, hsla(color, 0))
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, SIZE, SIZE)
}

// ---------- Module-level palette: background and sheets share one color set ----------
let colors = palette()
/** Which face is showing: 0 = A, 1 = B. All glow layers stay in sync */
let face = 0
const layers = new Set<HTMLDivElement>()
let timer: number | undefined

function canvasesOf(layer: HTMLDivElement, which: number): HTMLCanvasElement[] {
  return [...layer.querySelectorAll<HTMLCanvasElement>(`canvas[data-f="${which}"]`)]
}
function paintFace(layer: HTMLDivElement, which: number) {
  canvasesOf(layer, which).forEach((c, i) => paint(c, colors[i], alphaOf(i)))
}

/** Swap in a color set: paint the hidden face, then flip it forward (5s opacity transition in CSS) */
function refresh() {
  colors = palette()
  const next = 1 - face
  layers.forEach((layer) => paintFace(layer, next))
  face = next
  layers.forEach((layer) => { layer.dataset.face = String(face) })
}

function attach(layer: HTMLDivElement) {
  // Newly mounted layers (e.g. a just-opened sheet) paint the current color on the current face directly, no fade
  paintFace(layer, face)
  layer.dataset.face = String(face)
  layers.add(layer)
  if (layers.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('theme-change', refresh)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) timer = window.setInterval(refresh, 7000)
  }
  return () => {
    layers.delete(layer)
    if (!layers.size) { window.removeEventListener('theme-change', refresh); window.clearInterval(timer) }
  }
}

/** The four glow bodies. fixed = full-screen global background; otherwise fills the parent (used inside sheets) */
export function LiquidLayer({ fixed = false }: { fixed?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => (root.current ? attach(root.current) : undefined), [])
  return (
    <div ref={root} className={fixed ? 'liquid-bg' : 'liquid-layer'} data-face="0" aria-hidden="true">
      {['a', 'b', 'c', 'd'].map((k) => (
        <div key={k} className={`liquid-blob liquid-${k}`}>
          <canvas data-f="0" width={SIZE} height={SIZE} />
          <canvas data-f="1" width={SIZE} height={SIZE} />
        </div>
      ))}
    </div>
  )
}

export default function LiquidBackground() {
  return <LiquidLayer fixed />
}
