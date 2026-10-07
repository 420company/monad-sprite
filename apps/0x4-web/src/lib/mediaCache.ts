// 聊天媒体缓存：看过的图片 / 语音 / 视频按 URL 存进 IndexedDB，服务器上的文件过期（默认 30 天）后照样能看。
// 总量上限 300MB，超了按最近使用时间淘汰最旧的。私信媒体存的是下载下来的密文，打开时再解密。
// 「每天 00:00 自动清空」模式零点时整个清掉。
import { idbAvailable, req, tx } from './idb'

export interface MediaEntry { url: string; blob: Blob; size: number; at: number }
export interface MediaBackend {
  get(url: string): Promise<MediaEntry | undefined>
  put(e: MediaEntry): Promise<void>
  remove(urls: string[]): Promise<void>
  /** 全部条目的 url / 大小 / 最近使用时间（不需要 blob 本身） */
  list(): Promise<{ url: string; size: number; at: number }[]>
  clear(): Promise<void>
}

export const MEDIA_CACHE_MAX = 300 * 1024 * 1024

export class MediaCache {
  /** 本次运行里已经生成的 object URL，同一个文件不重复生成 */
  private urls = new Map<string, string>()
  constructor(private backend: MediaBackend, private maxBytes = MEDIA_CACHE_MAX, private now = () => Date.now()) {}

  async get(url: string): Promise<Blob | null> {
    const e = await this.backend.get(url)
    if (!e) return null
    // 记一下最近使用时间（LRU）
    await this.backend.put({ ...e, at: this.now() })
    return e.blob
  }

  async put(url: string, blob: Blob): Promise<void> {
    // 单个文件超过上限的四分之一就不缓存，免得一个大视频把别的都挤掉
    if (blob.size > this.maxBytes / 4) return
    await this.backend.put({ url, blob, size: blob.size, at: this.now() })
    await this.evict()
  }

  /** 超过上限时从最久没用的开始删 */
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

  /** 先查缓存，没有就下载并存起来。下载失败抛错 */
  async fetch(url: string, fetcher: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<Blob> {
    try { const hit = await this.get(url); if (hit) return hit } catch { /* 缓存坏了当作没有 */ }
    const r = await fetcher(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    try { await this.put(url, blob) } catch { /* 存不进去不影响这次显示 */ }
    return blob
  }

  /** 给 <img> / <video> / <audio> 用的本地地址 */
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
  // 走游标只取需要的字段；blob 在 IndexedDB 里是按需读的引用，不会整个载入内存
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

/** 正式用的实例。没有 IndexedDB 的环境不缓存，直接下载 */
export const mediaCache: MediaCache | null = idbAvailable() ? new MediaCache(idbMediaBackend) : null

/** 自己刚发出的媒体：服务器地址先指向本机那份，回显到了直接显示，不用再下载一遍（只在本次运行的内存里） */
const primed = new Map<string, string>()
export function primeMediaUrl(url: string, local: string): void { primed.set(url, local) }

/** 取媒体的本地地址：有缓存用缓存，没有就下载后缓存；环境不支持时原样返回 */
export async function cachedMediaUrl(url: string): Promise<string> {
  const hit = primed.get(url)
  if (hit) return hit
  if (!mediaCache || url.startsWith('blob:') || url.startsWith('data:')) return url
  return mediaCache.objectUrl(url)
}

/** 取媒体原始内容（私信媒体拿密文用） */
export async function cachedMediaBlob(url: string): Promise<Blob> {
  if (!mediaCache) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() }
  return mediaCache.fetch(url)
}
