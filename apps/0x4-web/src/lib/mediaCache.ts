// Chat media cache: viewed images / voice / videos stored in IndexedDB by URL, still viewable after the server's files expire (30 days by default).
// 300MB total cap; oldest-by-last-use evicted when exceeded. DM media stores the downloaded ciphertext, decrypted on open.
// "Auto-clear daily at 00:00" mode wipes everything at midnight.
import { idbAvailable, req, tx } from './idb'

export interface MediaEntry { url: string; blob: Blob; size: number; at: number }
export interface MediaBackend {
  get(url: string): Promise<MediaEntry | undefined>
  put(e: MediaEntry): Promise<void>
  remove(urls: string[]): Promise<void>
  /** All entries' url / size / last-used time (the blob itself not needed) */
  list(): Promise<{ url: string; size: number; at: number }[]>
  clear(): Promise<void>
}

export const MEDIA_CACHE_MAX = 300 * 1024 * 1024

export class MediaCache {
  /** Object URLs already minted this session; one file never mints twice */
  private urls = new Map<string, string>()
  constructor(private backend: MediaBackend, private maxBytes = MEDIA_CACHE_MAX, private now = () => Date.now()) {}

  async get(url: string): Promise<Blob | null> {
    const e = await this.backend.get(url)
    if (!e) return null
    // Record last-used time (LRU)
    await this.backend.put({ ...e, at: this.now() })
    return e.blob
  }

  async put(url: string, blob: Blob): Promise<void> {
    // Files over a quarter of the cap aren't cached — one big video must not crowd out everything else
    if (blob.size > this.maxBytes / 4) return
    await this.backend.put({ url, blob, size: blob.size, at: this.now() })
    await this.evict()
  }

  /** On overflow, delete least-recently-used first */
  async evict(): Promise<void> {
    const all = (await this.backend.list()).sort((a, b) => a.at - b.at)
    let total = all.reduce((s, e) => s + e.size, 0)
    const drop: string[] = []
    for (const e of all) {
      if (total <= this.maxBytes) break
      drop.push(e.url); total -= e.size
    }
    if (drop.length) {
      await this.backend.remove(drop)
      for (const u of drop) { const o = this.urls.get(u); if (o) { URL.revokeObjectURL?.(o); this.urls.delete(u) } }
    }
  }

  /** Check the cache first; download and store on miss. Download failures throw */
  async fetch(url: string, fetcher: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<Blob> {
    try { const hit = await this.get(url); if (hit) return hit } catch { /* A corrupt cache counts as a miss */ }
    const r = await fetcher(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    try { await this.put(url, blob) } catch { /* A failed store doesn't affect this display */ }
    return blob
  }

  /** Local URL for <img> / <video> / <audio> */
  async objectUrl(url: string): Promise<string> {
    const had = this.urls.get(url)
    if (had) return had
    const o = URL.createObjectURL(await this.fetch(url))
    this.urls.set(url, o)
    return o
  }

  async clear(): Promise<void> {
    for (const o of this.urls.values()) URL.revokeObjectURL?.(o)
    this.urls.clear()
    await this.backend.clear()
  }
}

export const idbMediaBackend: MediaBackend = {
  get: (url) => tx('media', 'readonly', (t) => req(t.objectStore('media').get(url) as IDBRequest<MediaEntry | undefined>)),
  put: (e) => tx('media', 'readwrite', (t) => { t.objectStore('media').put(e) }),
  remove: (urls) => tx('media', 'readwrite', (t) => { const s = t.objectStore('media'); for (const u of urls) s.delete(u) }),
  // Cursor over only the needed fields; IndexedDB blobs are on-demand references, never fully loaded into memory
  list: () => tx('media', 'readonly', (t) => new Promise<{ url: string; size: number; at: number }[]>((resolve, reject) => {
    const out: { url: string; size: number; at: number }[] = []
    const c = t.objectStore('media').openCursor()
    c.onsuccess = () => { const cur = c.result; if (!cur) return resolve(out); const v = cur.value as MediaEntry; out.push({ url: v.url, size: v.size, at: v.at }); cur.continue() }
    c.onerror = () => reject(c.error)
  })),
  clear: () => tx('media', 'readwrite', (t) => { t.objectStore('media').clear() }),
}

export function memoryMediaBackend(): MediaBackend & { map: Map<string, MediaEntry> } {
  const map = new Map<string, MediaEntry>()
  return {
    map,
    async get(url) { return map.get(url) },
    async put(e) { map.set(e.url, e) },
    async remove(urls) { for (const u of urls) map.delete(u) },
    async list() { return [...map.values()].map(({ url, size, at }) => ({ url, size, at })) },
    async clear() { map.clear() },
  }
}

/** The production instance. Environments without IndexedDB skip caching and download directly */
export const mediaCache: MediaCache | null = idbAvailable() ? new MediaCache(idbMediaBackend) : null

/** Just-sent media: the server URL first points at the local copy; the echo displays directly, no re-download (in-memory for this session only) */
const primed = new Map<string, string>()
export function primeMediaUrl(url: string, local: string): void { primed.set(url, local) }

/** Get a media's local URL: cache hit uses the cache, miss downloads then caches; returned as-is when the environment lacks support */
export async function cachedMediaUrl(url: string): Promise<string> {
  const hit = primed.get(url)
  if (hit) return hit
  if (!mediaCache || url.startsWith('blob:') || url.startsWith('data:')) return url
  return mediaCache.objectUrl(url)
}

/** Get a media's raw content (DM media uses this for ciphertext) */
export async function cachedMediaBlob(url: string): Promise<Blob> {
  if (!mediaCache) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() }
  return mediaCache.fetch(url)
}
