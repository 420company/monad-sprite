// 网页版浅色「香芋白」的液态玻璃动态（2026-10-03 goat 选定 Gemini 方向 1「清透透镜」+ 方向 2「流体水银」）：
// 1. 环境光：<body> 最前面一层 .lq-amb（几团很慢流动的珍珠色光）+ 很淡的同心圆辅助线；样式和动画在 light.css，深色下不显示。
// 2. 透镜：顶部导航胶囊、次要按钮、各分段控件里的选中块，按各自尺寸挂上透镜滤镜（lens.ts，只有 Chromium 有）。
// 3. 液态选中块：分段控件、链筛选、顶部导航、标签页的「选中」不再是按钮自己的底色，而是容器 ::before 画的一颗玻璃水滴，
//    切换时带着拉伸滑过去、到位回弹（位置写在容器的 --ix/--iy/--iw/--ih）。用伪元素不往 React 管的节点里塞东西。
// 4. 水波：按钮按下时从按下的位置扩散一圈光（--rx/--ry + .lq-rip 重新触发动画）。
// 5. 鼠标反光：玻璃面板上的柔光和边缘亮线跟着鼠标走（--lx/--ly）。
// 6. 自动降级：页面安顿后测两次帧率，都太低（老电脑、核显）才给 <html> 加 .lq-lite，light.css 据此关掉透镜和流动背景。
// 只在浅色主题和「空间」外观（2026-10-03，data-look="space"）时做事；系统开了「减少动态效果」时不做动效（选中块直接到位）。
import { applyLens, lensFilter, lensSupported } from './lens'

const LIT = '.wc-panel, .tx-panel, .cm-panel, .cm-pc, .cm-meetbar, .desk-need, .desk-gate-card, .sm-opt'
/** 挂透镜的小元素（数量少、尺寸小，显卡吃得消） */
const LENS = '.desk-bar-in, .desk-me, .desk-lang, .cm-btn.is-quiet, .wc-btn:not(.is-primary):not(.is-ghost):not(.is-up):not(.is-down):not(.is-danger):not(.is-sm)'
/** 「空间」外观另外的漂浮胶囊：左边图标栏、品牌、右上工具（玻璃画在 ::before 上，--lens 会继承过去） */
const LENS_SPACE = '.desk-nav, .desk-brand-link, .desk-tools'
/** 液态选中块：容器 / 选中项 / 形状（pill = 玻璃水滴垫在下面，line = 底下一条会拉伸的线） */
const GROUPS: { sel: string; active: string; kind: 'pill' | 'line' }[] = [
  { sel: '.desk-nav', active: '.desk-nav-item.on', kind: 'pill' },
  { sel: '.wc-seg, .cm-seg, .tx-seg', active: ':scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > .on', kind: 'pill' },
  { sel: '.tx-chains', active: ':scope > .on, :scope > [aria-pressed="true"]', kind: 'pill' },
  { sel: '.wc-tabs, .tx-tabs', active: ':scope > [aria-selected="true"], :scope > .on', kind: 'line' },
]
const RIPPLE = '.wc-btn, .tx-btn, .cm-btn, .wc-seg button, .cm-seg button, .tx-seg button, .tx-chains button'

const space = () => document.documentElement.dataset.look === 'space'
/** 香芋白或「空间」：这两种外观才有玻璃动效 */
const light = () => document.documentElement.dataset.theme === 'light' || space()
const lite = () => document.documentElement.classList.contains('lq-lite')
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function mountLiquid(): void {
  if (typeof document === 'undefined' || document.querySelector('.lq-amb')) return
  const amb = document.createElement('div')
  amb.className = 'lq-amb'
  amb.setAttribute('aria-hidden', 'true')
  amb.innerHTML = '<i></i><i></i><i></i><i></i><b></b>'
  document.body.prepend(amb)

  // ---------- 选中块 + 透镜：页面变化后（下一帧）统一重算 ----------
  let placed = new WeakMap<HTMLElement, string>()
  const lensed = new Set<HTMLElement>()
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => { for (const e of es) applyLens(e.target as HTMLElement); schedule() }) : null
  let raf = 0
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update) }
  function update() {
    raf = 0
    if (!light()) return
    // 透镜
    if (lensSupported && !lite()) {
      for (const el of document.querySelectorAll<HTMLElement>(space() ? `${LENS}, ${LENS_SPACE}` : LENS)) {
        if (lensed.has(el)) continue
        lensed.add(el); applyLens(el); ro?.observe(el)
      }
      for (const el of lensed) if (!el.isConnected) { lensed.delete(el); ro?.unobserve(el) }
    }
    // 选中块
    for (const g of GROUPS) {
      for (const box of document.querySelectorAll<HTMLElement>(g.sel)) {
        const on = box.querySelector<HTMLElement>(g.active)
        if (!on || !on.offsetWidth) { box.classList.remove('lq-ind'); placed.delete(box); continue }
        const bx = box.getBoundingClientRect(), ox = on.getBoundingClientRect()
        const x = ox.left - bx.left + box.scrollLeft, y = ox.top - bx.top + box.scrollTop
        const key = `${Math.round(x)},${Math.round(y)},${Math.round(ox.width)},${Math.round(ox.height)}`
        const prev = placed.get(box)
        if (prev === key) continue
        placed.set(box, key)
        box.style.setProperty('--ix', `${x}px`); box.style.setProperty('--iy', `${y}px`)
        box.style.setProperty('--iw', `${ox.width}px`); box.style.setProperty('--ih', `${ox.height}px`)
        if (g.kind === 'pill' && lensSupported && !lite()) {
          const r = parseFloat(getComputedStyle(on).borderTopLeftRadius) || ox.height / 2
          const url = lensFilter(ox.width, ox.height, r)
          if (url) box.style.setProperty('--lens-ind', url)
        }
        if (!prev) {
          // 第一次出现：直接放到位，不滑
          box.classList.add('lq-ind', 'lq-ind-' + g.kind, 'lq-snap')
          requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('lq-snap')))
        } else if (!reduced()) {
          // 换了选中项：滑过去，途中拉伸（水银的表面张力），到位回弹
          box.classList.remove('lq-moving'); void box.offsetWidth; box.classList.add('lq-moving')
          setTimeout(() => box.classList.remove('lq-moving'), 520)
        }
      }
    }
  }
  const mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected'] })
  // 换外观时选中块直接到位（导航从顶栏变成左边竖栏，不要从上面飞过去）
  let lookKey = ''
  new MutationObserver(() => {
    const k = `${document.documentElement.dataset.theme}|${document.documentElement.dataset.look ?? ''}`
    if (k !== lookKey) { lookKey = k; placed = new WeakMap() }
    if (light()) schedule()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look', 'class'] })
  addEventListener('resize', schedule)
  schedule()

  // ---------- 水波 ----------
  document.addEventListener('pointerdown', (e) => {
    if (!light() || reduced()) return
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>(RIPPLE) : null
    if (!el || (el as HTMLButtonElement).disabled) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--rx', `${e.clientX - r.left}px`); el.style.setProperty('--ry', `${e.clientY - r.top}px`)
    el.classList.remove('lq-rip'); void el.offsetWidth; el.classList.add('lq-rip')
    setTimeout(() => el.classList.remove('lq-rip'), 600)
  }, { passive: true })

  if (reduced()) return

  // ---------- 鼠标反光 ----------
  let cur: HTMLElement | null = null
  let ev: PointerEvent | null = null
  let praf = 0
  const clear = () => {
    if (!cur) return
    cur.classList.remove('lq-lit'); cur.style.removeProperty('--lx'); cur.style.removeProperty('--ly')
    cur = null
  }
  const tick = () => {
    praf = 0
    const e = ev
    if (!e) return
    if (!light()) { clear(); return }
    const el = (e.target instanceof Element ? e.target.closest(LIT) : null) as HTMLElement | null
    if (el !== cur) { clear(); if (el) { cur = el; el.classList.add('lq-lit') } }
    if (!cur) return
    const r = cur.getBoundingClientRect()
    cur.style.setProperty('--lx', `${Math.round(e.clientX - r.left)}px`)
    cur.style.setProperty('--ly', `${Math.round(e.clientY - r.top)}px`)
  }
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; ev = e; if (!praf) praf = requestAnimationFrame(tick) }, { passive: true })
  document.documentElement.addEventListener('pointerleave', clear)
  addEventListener('blur', clear)

  // ---------- 自动降级：页面安顿下来后（4 秒）量 1.5 秒帧率，连着两次平均低于 40 帧才关掉重的效果 ----------
  // 只量一次会误判：刚打开时页面在加载行情、图表，正常电脑也会掉帧（本机预览实测过）
  const measure = (then: (slow: boolean) => void) => {
    if (document.hidden) return
    let n = 0
    const t0 = performance.now()
    const count = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(count); else then(n / 1.5 < 40) }
    requestAnimationFrame(count)
  }
  setTimeout(() => measure((slow) => {
    if (!slow) return
    setTimeout(() => measure((again) => {
      if (!again) return
      document.documentElement.classList.add('lq-lite')
      for (const el of lensed) el.style.removeProperty('--lens')
      for (const el of document.querySelectorAll<HTMLElement>('.lq-ind')) el.style.removeProperty('--lens-ind')
    }), 2500)
  }), 4000)
}
