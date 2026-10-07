// 网页版第三种外观「空间」的背景（2026-10-03 goat 选 Gemini 方向 5，参考 Vision Pro）：
// 1. 整页背后铺一张虚化的照片（8 张内置，或用户自己选的图片）。图片只在选了「空间」时才下载，同一时间只下载选中的那一张。
// 2. 用户自己的图片：在本机缩到 2400 宽、转成 webp，存在这台电脑浏览器的 IndexedDB 里，不上传、不进服务器（goat：以后电脑客户端直接用桌面壁纸）。
// 3. 视差：鼠标移动时背景反方向微微平移（最多十几像素，带阻尼），有「窗口浮在空间里」的感觉。
//    交易终端页、系统开了「减少动态效果」、liquid.ts 判定电脑跑不动（html.lq-lite）时不动：背景一动，顶栏、胶囊、表头这些玻璃都得重新模糊。
// 样式在 space.css（.sp-wall），只在 <html data-look="space"> 时显示。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
// 背景图：src/desktop/img/space/<id>.webp（大图，选中才下载）+ <id>-s.webp（缩略图）。原图和出图脚本在 docs/art-src/space-walls
const FILES = import.meta.glob<string>('./img/space/*.webp', { eager: true, query: '?url', import: 'default' })
const file = (n: string) => FILES[`./img/space/${n}.webp`] ?? ''

/** 内置背景（2026-10-03 goat 从生成的 31 张里挑了这 8 张：抽象 4 张 + 星云、地球、深海、沙丘）。第一张是默认。label 显示时 t() */
const LIST: [id: string, label: string][] = [
  ['nebula', '星云'], ['orbit', '地球'], ['deepsea', '深海'], ['dunes', '沙丘'],
  ['haze', '霞光'], ['pearl', '珍珠'], ['silk', '丝绸'], ['prism', '棱镜'],
]
export const SPACE_WALLS = LIST.map(([id, label]) => ({ id, label, src: file(id), thumb: file(`${id}-s`) }))
const DEFAULT_WALL = SPACE_WALLS[0].id

/** 内置背景的 id，或 'custom' = 用户自己的图片 */
export type SpaceWall = string

interface SpaceState {
  wall: SpaceWall
  /** 用户自己的图片（本机 IndexedDB 读出来的 blob: 地址），没有为 null */
  customUrl: string | null
  setWall: (w: SpaceWall) => void
  setCustom: (file: File) => Promise<void>
  clearCustom: () => Promise<void>
}

// ---------- 本机存图（IndexedDB，库 0x4-space，表 files，键 wall） ----------
const DB = '0x4-space'
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('files') }
    req.onerror = () => fail(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('files', mode)
      const r = fn(tx.objectStore('files'))
      r.onsuccess = () => ok(r.result as T)
      r.onerror = () => fail(r.error)
      tx.oncomplete = () => db.close()
    }
  })
}

/** 把用户选的图片缩到最长边 2400、转 webp（不支持就 jpeg）。背景本来就要虚化，不需要原图那么大 */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', .85))
  if (out && out.type === 'image/webp') return out
  const jpg = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', .85))
  if (!jpg) throw new Error('image')
  return jpg
}

export const useSpace = create<SpaceState>()(
  persist(
    (set, get) => ({
      wall: DEFAULT_WALL,
      customUrl: null,
      setWall: (wall) => set({ wall: wall === 'custom' ? (get().customUrl ? wall : get().wall) : SPACE_WALLS.some((w) => w.id === wall) ? wall : get().wall }),
      async setCustom(file) {
        if (!file.type.startsWith('image/')) throw new Error('type')
        if (file.size > 25 * 1024 * 1024) throw new Error('size')
        const blob = await shrink(file)
        await idb('readwrite', (s) => s.put(blob, 'wall'))
        const old = get().customUrl
        if (old) URL.revokeObjectURL(old)
        set({ customUrl: URL.createObjectURL(blob), wall: 'custom' })
      },
      async clearCustom() {
        try { await idb('readwrite', (s) => s.delete('wall')) } catch { /* 读不到库就当没有 */ }
        const old = get().customUrl
        if (old) URL.revokeObjectURL(old)
        set({ customUrl: null, wall: get().wall === 'custom' ? DEFAULT_WALL : get().wall })
      },
    }),
    {
      name: '0x4.space', partialize: (s) => ({ wall: s.wall }),
      // 存的是已经下架的背景（10/03 从 31 张减到 8 张）：换成默认的
      merge: (persisted, current) => {
        const w = (persisted as { wall?: string } | undefined)?.wall
        return { ...current, wall: w === 'custom' || SPACE_WALLS.some((x) => x.id === w) ? w! : DEFAULT_WALL }
      },
    },
  ),
)

/** 当前该铺哪张图 */
export function wallSrc(s: Pick<SpaceState, 'wall' | 'customUrl'>): string {
  if (s.wall === 'custom' && s.customUrl) return s.customUrl
  return (SPACE_WALLS.find((w) => w.id === s.wall) ?? SPACE_WALLS[0]).src
}

const isSpace = () => document.documentElement.dataset.look === 'space'

/** 图片的平均亮度（0~255）：缩到 24×15 取平均。图都是同源或本机 blob，画布读得出像素 */
function brightness(src: string): Promise<number> {
  return new Promise((ok) => {
    const im = new Image()
    im.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 24; c.height = 15
        const ctx = c.getContext('2d')
        if (!ctx) return ok(100)
        ctx.drawImage(im, 0, 0, 24, 15)
        const d = ctx.getImageData(0, 0, 24, 15).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]
        ok(sum / (d.length / 4))
      } catch { ok(100) }
    }
    im.onerror = () => ok(100)
    im.src = src
  })
}
/** 亮度 → 压暗多少：暗图（≤70）压 .12，越亮压得越多，最多 .5 */
export const dimFor = (l: number): number => Math.round(Math.min(.5, Math.max(.12, .12 + (l - 70) / 185 * .38)) * 100) / 100

export function mountSpace(): void {
  if (typeof document === 'undefined' || document.querySelector('.sp-wall')) return
  const layer = document.createElement('div')
  layer.className = 'sp-wall'
  layer.setAttribute('aria-hidden', 'true')
  const img = document.createElement('i')
  layer.appendChild(img)
  document.body.prepend(layer)

  // 本机存过自己的图片：读出来（隐私模式等读不到就当没有，退回内置第一张）
  idb<Blob | undefined>('readonly', (s) => s.get('wall'))
    .then((blob) => { if (blob) useSpace.setState({ customUrl: URL.createObjectURL(blob) }) })
    .catch(() => { if (useSpace.getState().wall === 'custom') useSpace.setState({ wall: DEFAULT_WALL }) })

  // 只在「空间」外观时才把图挂上去（挂上才会下载）
  let shown = ''
  const paint = () => {
    const src = isSpace() ? wallSrc(useSpace.getState()) : ''
    if (src === shown) return
    shown = src
    img.style.backgroundImage = src ? `url("${src}")` : ''
    if (src) void brightness(src).then((l) => { if (shown === src) layer.style.setProperty('--sp-dim', String(dimFor(l))) })
  }
  useSpace.subscribe(paint)
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-look'] })
  paint()

  // ---------- 视差 ----------
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0
  const still = () => !isSpace() || document.documentElement.classList.contains('lq-lite') || !!document.querySelector('.desk-term')
  const step = () => {
    raf = 0
    x += (tx - x) * .08; y += (ty - y) * .08
    img.style.setProperty('--sp-x', `${x.toFixed(2)}px`)
    img.style.setProperty('--sp-y', `${y.toFixed(2)}px`)
    if (Math.abs(tx - x) > .05 || Math.abs(ty - y) > .05) raf = requestAnimationFrame(step)
  }
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    if (still()) { tx = 0; ty = 0 } else { tx = (.5 - e.clientX / innerWidth) * 18; ty = (.5 - e.clientY / innerHeight) * 12 }
    if (!raf) raf = requestAnimationFrame(step)
  }, { passive: true })
}
