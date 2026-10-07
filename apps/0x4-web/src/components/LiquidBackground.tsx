// 全局液态流体背景（2026-09-25 0x4 改版）。
//
// 四团大柔光各自慢慢漂（CSS 动画），颜色每 7 秒随机换一组、用 5 秒淡入淡出过去。
//
// ⚠️ 渲染方式的历史（每一版都是真机上出过事才改的，改之前先看完）：
//   1. 最早：@property 注册颜色变量 + 在 :root 上做过渡。WebKit 对注册属性的动画有过崩溃问题，
//      而且每 7 秒让整页所有用到颜色变量的元素一起重算。
//   2. 09-25：每团光斑是纯色块（background-color 过渡）+ mask 径向渐变做柔边。光斑原来每团 85–95vmax，
//      3 倍屏上一团约 2900×2900 像素的图层（约 30MB），四团 100MB+，iOS 判内存超标杀掉网页进程，
//      App 看起来「自己刷新了一下」。于是元素缩到 1/3 尺寸 + transform: scale(3) 放大。
//   3. 09-26（本版）：goat 反馈「背景换色时屏幕卡顿闪烁」。原因：background-color 过渡不是合成层动画，
//      5 秒里每一帧都要把四团光斑（连同它们的遮罩图层）重画一遍、重新上传；上面的毛玻璃
//      （.glass / .app-nav / .nav-floor 等 backdrop-filter）跟着每帧重算，掉帧、闪。
//
// 现在的做法：
//   · 每团光斑的「形状」画在一张 128×128 的小 canvas 上（径向渐变，透明度也烘进去），CSS 把它拉大显示。
//     canvas 图层的显存只看它自己的像素数，跟屏幕上显示多大、设备几倍屏都无关：一张 128×128×4 = 64KB。
//     柔光本来就是平滑渐变，放大后看不出颗粒。
//   · 每团光斑里放两张 canvas（A / B），交叉淡入淡出：新颜色先画到当前看不见的那张上（瞬间画好，
//     不过渡），再切 opacity（合成层动画，不重画、不上传位图）。一次换色只在切换那一刻画两张 64KB 的小图。
//   · 显存估算：每个光斑层 4 团 × 2 张 × 64KB = 512KB；全局背景 + 最多几层弹层也就 1–2MB。
//     对比第 2 版（四团 1/3 尺寸的色块 + 各自的遮罩图层，3 倍屏上合计约 17MB，若 WebKit 按放大后的倍率栅格化还会更多）
//     大幅下降。外层 .liquid-blob 只负责漂移（transform 动画），自己不画任何东西、没有位图。
//   · 外层不再设 opacity（父层 opacity + 子图层会让系统每帧多做一次离屏合成），透明度直接画进渐变里。
//   · 换色时不走 React：模块直接画 canvas、切 data-face，不触发任何组件重渲染。
// 颜色放在模块级的色板里，弹层（Sheet）和通话界面用 <LiquidLayer /> 画同一组光斑，跟背景一起变。
// 系统开了「减少动态效果」时不漂也不换色；不接收点击。
import { useLayoutEffect, useRef } from 'react'
import { currentTheme } from '@/lib/theme'

/**
 * 只在好看的色系里挑：蜜桃、玫瑰、紫、靛蓝、冰青、青绿。
 * 黄绿一带（约 50°–150°）在暗底上发浑像泥巴色，实测难看，不进候选。
 * 每次洗牌取四个，再各自抖 ±12°。
 */
const HUES = [20, 340, 290, 262, 228, 196, 176]
type Hsl = [number, number, number]

function palette(): Hsl[] {
  const pool = [...HUES].sort(() => Math.random() - 0.5).slice(0, 4)
  return pool.map((h, i) => {
    const hue = Math.round((h + Math.random() * 24 - 12 + 360) % 360)
    // 深色：饱和度中等、亮度压低，只做氛围不抢内容；浅色：粉彩，亮度拉高
    const pale = currentTheme() === 'light'
    const sat = (pale ? 70 : 55) + Math.round(Math.random() * 20)
    const light = pale ? 78 + Math.round(Math.random() * 7) : i === 0 ? 46 : 40 + Math.round(Math.random() * 8)
    return [hue, sat, light]
  })
}

/** 每团光斑中心的不透明度（原来写在 CSS 的 opacity 上：深色 .55、第四团 .4；浅色一律 .75） */
function alphaOf(i: number): number {
  if (currentTheme() === 'light') return 0.75
  return i === 3 ? 0.4 : 0.55
}

const SIZE = 128
const hsla = ([h, s, l]: Hsl, a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`

/** 在 canvas 上画一团柔光：中心实色 → 边缘全透明（等同原来的 mask radial-gradient(closest-side, #000, transparent)） */
function paint(canvas: HTMLCanvasElement, color: Hsl, alpha: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const r = SIZE / 2
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  // 两端用同一个色相，只变透明度，避免中间过渡发灰
  g.addColorStop(0, hsla(color, alpha))
  g.addColorStop(1, hsla(color, 0))
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, SIZE, SIZE)
}

// ---------- 模块级色板：背景和弹层共用同一组颜色 ----------
let colors = palette()
/** 当前显示的是哪一张：0 = A，1 = B。所有光斑层同步 */
let face = 0
const layers = new Set<HTMLDivElement>()
let timer: number | undefined

function canvasesOf(layer: HTMLDivElement, which: number): HTMLCanvasElement[] {
  return [...layer.querySelectorAll<HTMLCanvasElement>(`canvas[data-f="${which}"]`)]
}
function paintFace(layer: HTMLDivElement, which: number) {
  canvasesOf(layer, which).forEach((c, i) => paint(c, colors[i], alphaOf(i)))
}

/** 换一组颜色：画到看不见的那一面，再把它翻到前面（CSS 里 opacity 过渡 5 秒） */
function refresh() {
  colors = palette()
  const next = 1 - face
  layers.forEach((layer) => paintFace(layer, next))
  face = next
  layers.forEach((layer) => { layer.dataset.face = String(face) })
}

function attach(layer: HTMLDivElement) {
  // 新挂上的层（比如刚打开的弹层）直接画当前颜色、当前那一面，不做淡入
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

/** 四团光斑本体。fixed = 铺满整屏的全局背景；否则填满父元素（弹层里用） */
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
