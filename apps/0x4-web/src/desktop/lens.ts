// Lens refraction (2026-10-03 goat picked Gemini direction 1 "clear lens"): like the clear glass on Apple's design page hero — things behind the glass get slightly magnified,
// bending only around the edge ring, with a hint of rainbow dispersion at the edge. Same principle as dev/lens-test.html:
//   each element computes its own displacement map on canvas from its size (rounded-rect distance field: neutral gray in the middle = no distortion, the bezel-wide edge ring folds inward cubically),
//   made into an SVG filter; the R / G / B channels are displaced once each at strengths 30 / 26 / 22 then recombined → rainbow edge.
// Elements get --lens: url(#filter-id); light.css applies backdrop-filter: var(--lens); same-size elements share one filter (cached).
// Only Chromium (Chrome / Edge / Brave) supports SVG filters as backdrop-filter; other browsers don't get --lens, and CSS falls back to plain glass.
const SVG = 'http://www.w3.org/2000/svg'

export const lensSupported = (() => {
  try {
    const ua = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
    return !!ua.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand))
  } catch { return false }
})()

/** Signed distance of a rounded rect (negative inside) */
function sdf(x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** Displacement map: displaced only in the bezel-wide edge ring, sampling inward (the background at the edge is pushed outward = magnified feel) */
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
        const t = 1 + s / bezel          // 1 at the edge, 0 at the bevel's inner side
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

/** Lens filter id for a size (sizes rounded to 2px, shared per size) */
export function lensFilter(width: number, height: number, radius: number): string | null {
  const w = Math.max(8, Math.round(width / 2) * 2), h = Math.max(8, Math.round(height / 2) * 2)
  const r = Math.min(Math.round(radius), Math.floor(Math.min(w, h) / 2))
  if (w * h > 400_000) return null          // Skip too-large ones (slow to compute, GPU-hungry)
  const key = `${w}x${h}x${r}`
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return hit }   // Move to most-recent so eviction reaches it last
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
  // Window resizing keeps producing new sizes: keep only the 48 most recent; the least-recently-used ones are deleted with their filters (elements still using them switch to new ones when their size changes)
  if (cache.size > 48) {
    const [oldKey, oldUrl] = cache.entries().next().value as [string, string]
    cache.delete(oldKey)
    document.getElementById(oldUrl.slice(5, -1))?.remove()
  }
  return url
}

/** Write --lens on the element for its current size (replaced when the size changes) */
export function applyLens(el: HTMLElement): void {
  if (!lensSupported) return
  const w = el.offsetWidth, h = el.offsetHeight
  if (!w || !h) return
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
  const url = lensFilter(w, h, r)
  if (url) el.style.setProperty('--lens', url)
  else el.style.removeProperty('--lens')
}
