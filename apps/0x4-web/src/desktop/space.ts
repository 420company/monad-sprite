// Background for the web's third look "Space" (2026-10-03 goat picked Gemini direction 5, referencing Vision Pro):
// 1. A blurred photo behind the whole page (8 built-in, or the user's own image). Images download only when "Space" is selected, and only the selected one at a time.
// 2. The user's own image: downscaled to 2400 wide on-device, converted to webp, stored in this computer's browser IndexedDB — never uploaded, never reaches the server (goat: the future desktop client will just use the desktop wallpaper).
// 3. Parallax: the background drifts slightly against the mouse (a dozen px at most, damped), giving a "windows floating in space" feel.
//    Disabled on the trading terminal page, when the OS has "reduce motion" on, or when liquid.ts deems the machine too slow (html.lq-lite): moving the background forces every glass surface (top bar, capsules, headers) to re-blur.
// Styles in space.css (.sp-wall), shown only under <html data-look="space">.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
// Wallpaper: src/desktop/img/space/<id>.webp (large, downloads only when selected) + <id>-s.webp (thumbnail). Source art and export scripts in docs/art-src/space-walls
const FILES = import.meta.glob<string>('./img/space/*.webp', { eager: true, query: '?url', import: 'default' })
const file = (n: string) => FILES[`./img/space/${n}.webp`] ?? ''

/** Built-in wallpapers (2026-10-03 goat picked these 8 from 31 generated: 4 abstract + nebula, earth, deep sea, dunes). The first is the default. label goes through t() at display time */
const LIST: [id: string, label: string][] = [
  ['nebula', '星云'], ['orbit', '地球'], ['deepsea', '深海'], ['dunes', '沙丘'],
  ['haze', '霞光'], ['pearl', '珍珠'], ['silk', '丝绸'], ['prism', '棱镜'],
]
export const SPACE_WALLS = LIST.map(([id, label]) => ({ id, label, src: file(id), thumb: file(`${id}-s`) }))
const DEFAULT_WALL = SPACE_WALLS[0].id

/** Built-in wallpaper id, or 'custom' = the user's own image */
export type SpaceWall = string

interface SpaceState {
  wall: SpaceWall
  /** The user's own image (blob: URL read from local IndexedDB), null if none */
  customUrl: string | null
  setWall: (w: SpaceWall) => void
  setCustom: (file: File) => Promise<void>
  clearCustom: () => Promise<void>
}

// ---------- Local image storage (IndexedDB, db 0x4-space, table files, key wall) ----------
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

/** Downscale the user's chosen image to 2400 on the long side, convert to webp (jpeg where unsupported). The background gets blurred anyway — no need for full size */
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
        try { await idb('readwrite', (s) => s.delete('wall')) } catch { /* If the db can't be read, treat as none */ }
        const old = get().customUrl
        if (old) URL.revokeObjectURL(old)
        set({ customUrl: null, wall: get().wall === 'custom' ? DEFAULT_WALL : get().wall })
      },
    }),
    {
      name: '0x4.space', partialize: (s) => ({ wall: s.wall }),
      // The stored wallpaper was retired (10/03 cut from 31 to 8): fall back to the default
      merge: (persisted, current) => {
        const w = (persisted as { wall?: string } | undefined)?.wall
        return { ...current, wall: w === 'custom' || SPACE_WALLS.some((x) => x.id === w) ? w! : DEFAULT_WALL }
      },
    },
  ),
)

/** Which image should currently be laid down */
export function wallSrc(s: Pick<SpaceState, 'wall' | 'customUrl'>): string {
  if (s.wall === 'custom' && s.customUrl) return s.customUrl
  return (SPACE_WALLS.find((w) => w.id === s.wall) ?? SPACE_WALLS[0]).src
}

const isSpace = () => document.documentElement.dataset.look === 'space'

/** Average image brightness (0–255): downscale to 24×15 and average. Images are same-origin or local blobs, so canvas can read the pixels */
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
/** Brightness → how much to darken: dark images (≤70) get .12, brighter gets more, up to .5 */
export const dimFor = (l: number): number => Math.round(Math.min(.5, Math.max(.12, .12 + (l - 70) / 185 * .38)) * 100) / 100

export function mountSpace(): void {
  if (typeof document === 'undefined' || document.querySelector('.sp-wall')) return
  const layer = document.createElement('div')
  layer.className = 'sp-wall'
  layer.setAttribute('aria-hidden', 'true')
  const img = document.createElement('i')
  layer.appendChild(img)
  document.body.prepend(layer)

  // The user stored their own image: read it out (if unreadable — incognito etc. — treat as none, fall back to the first built-in)
  idb<Blob | undefined>('readonly', (s) => s.get('wall'))
    .then((blob) => { if (blob) useSpace.setState({ customUrl: URL.createObjectURL(blob) }) })
    .catch(() => { if (useSpace.getState().wall === 'custom') useSpace.setState({ wall: DEFAULT_WALL }) })

  // Only mount the image under the "Space" look (mounting is what triggers the download)
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

  // ---------- Parallax ----------
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
