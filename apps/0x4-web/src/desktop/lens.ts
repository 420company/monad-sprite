// 透镜折射（2026-10-03 goat 选定 Gemini 方向 1「清透透镜」）：按 Apple 设计页首屏那种清透玻璃，背后的东西透过玻璃被轻微放大，
// 只在边缘一圈弯折，边缘有一点彩虹色散。原理和 dev/lens-test.html 一样：
//   每个元素按自己的尺寸用 canvas 现算一张位移图（圆角矩形距离场：中间中性灰 = 不变形，边缘 bezel 宽的一圈按三次方往里折），
//   做成一个 SVG 滤镜，R / G / B 三个通道用 30 / 26 / 22 的强度各位移一次再合起来 → 彩虹边。
// 元素上写 --lens: url(#滤镜 id)，light.css 里 backdrop-filter: var(--lens) 用上；同尺寸共用一个滤镜（缓存）。
// 只有 Chromium（Chrome / Edge / Brave）支持把 SVG 滤镜当 backdrop-filter，其他浏览器不写 --lens，CSS 退回普通玻璃。
const SVG = 'http://www.w3.org/2000/svg'

export const lensSupported = (() => {
  try {
    const ua = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
    return !!ua.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand))
  } catch { return false }
})()

/** 圆角矩形的有向距离（里面为负） */
function sdf(x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** 位移图：只在边缘 bezel 宽的一圈有位移，往里取样（背后画面在边缘被往外推 = 放大感） */
function bakeMap(w: number, h: number, r: number, bezel: number): string {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(w, h), d = img.data, e = .75
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + .5, py = y + .5, s = sdf(px, py, w, h, r)
      let dx = 0, dy = 0
      if (s < 0 && -s < bezel) {
        const nx = (sdf(px + e, py, w, h, r) - sdf(px - e, py, w, h, r)) / (2 * e)
        const ny = (sdf(px, py + e, w, h, r) - sdf(px, py - e, w, h, r)) / (2 * e)
        const t = 1 + s / bezel          // 边上 1，斜面里侧 0
        const k = t * t * t
        dx = -nx * k; dy = -ny * k
      }
      const i = (y * w + x) * 4
      d[i] = 128 + dx * 127; d[i + 1] = 128 + dy * 127; d[i + 2] = 128; d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}

let defs: SVGDefsElement | null = null
const cache = new Map<string, string>()
let seq = 0

/** 某个尺寸的透镜滤镜 id（尺寸取整到 2px，同尺寸共用） */
export function lensFilter(width: number, height: number, radius: number): string | null {
  const w = Math.max(8, Math.round(width / 2) * 2), h = Math.max(8, Math.round(height / 2) * 2)
  const r = Math.min(Math.round(radius), Math.floor(Math.min(w, h) / 2))
  if (w * h > 400_000) return null          // 太大的不做（算图慢、也耗显卡）
  const key = `${w}x${h}x${r}`
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return hit }   // 挪到最新，淘汰时最后才轮到
  if (!defs) {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    defs = document.createElementNS(SVG, 'defs') as SVGDefsElement
    svg.appendChild(defs)
    document.body.appendChild(svg)
  }
  const map = bakeMap(w, h, r, Math.max(6, Math.min(r * .9, 24)))
  if (!map) return null
  const id = `lq-lens-${++seq}`
  const f = document.createElementNS(SVG, 'filter')
  for (const [k, v] of Object.entries({ id, x: '0', y: '0', width: String(w), height: String(h), filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v)
  f.innerHTML = `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" result="map"/>`
    + ['30', '26', '22'].map((s, i) => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="d${i}"/>`).join('')
    + `<feColorMatrix in="d0" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>`
    + `<feColorMatrix in="d1" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>`
    + `<feColorMatrix in="d2" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>`
    + `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`
  defs.appendChild(f)
  const url = `url(#${id})`
  cache.set(key, url)
  // 拖窗口大小会不停出新尺寸：只留最近 48 个，最久没用的连滤镜一起删（还在用它的元素尺寸一变就会换新的）
  if (cache.size > 48) {
    const [oldKey, oldUrl] = cache.entries().next().value as [string, string]
    cache.delete(oldKey)
    document.getElementById(oldUrl.slice(5, -1))?.remove()
  }
  return url
}

/** 给元素按当前尺寸写上 --lens（尺寸变了会换） */
export function applyLens(el: HTMLElement): void {
  if (!lensSupported) return
  const w = el.offsetWidth, h = el.offsetHeight
  if (!w || !h) return
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
  const url = lensFilter(w, h, r)
  if (url) el.style.setProperty('--lens', url)
  else el.style.removeProperty('--lens')
}
