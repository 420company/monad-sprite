// DM media end-to-end encryption: files are encrypted locally with a random AES-GCM key before upload; the key travels inside the (itself encrypted) DM body — the server only ever sees ciphertext bytes
import { SOCIAL_API, uploadFile } from './social'
import { t } from '@/lib/i18n'
import { makeImageVariants } from './imageCompress'
import { cachedMediaBlob } from './mediaCache'

/** thumb / w / h were added later: old messages lack them, fall back to the url copy at display.
 *  items is multi-image messages (2026-09-26): each image gets its own key and upload; the outer fields are
 *  the first image, so old app versions see at least that one */
export interface DmMedia { t: 'media'; kind: 'image' | 'video' | 'voice'; url: string; key: string; iv: string; mime: string; duration?: number; size: number; thumb?: { url: string; iv: string; mime: string }; w?: number; h?: number; items?: DmMedia[] }
// Body prefix: one invisible control char + dm: — plain text never starts with it
const MARK = String.fromCharCode(1) + 'dm:'
/** Media URL → decrypted local object URL (memory only) */
const cache = new Map<string, Promise<string>>()
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

type Upload = (data: Blob, name: string, onProgress?: (f: number) => void) => Promise<{ url: string }>
const defaultUpload: Upload = (data, name, onProgress) => uploadFile(data, name, onProgress)

async function encryptUpload(key: CryptoKey, data: Blob, upload: Upload, onProgress?: (f: number) => void) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await data.arrayBuffer())
  const r = await upload(new Blob([ct], { type: 'application/octet-stream' }), 'media.bin', onProgress)
  return { url: r.url, iv: b64(iv) }
}

/**
 * Encrypt and upload one file, returning the media descriptor. Images are first compressed locally into a
 * large copy + thumbnail (same key, separate ivs); the original is never uploaded.
 * After upload, register the local copy in the decrypt cache so my own message echo displays immediately,
 * no download-decrypt round trip.
 */
export async function encryptMedia(file: Blob, kind: DmMedia['kind'], opts: { duration?: number; onProgress?: (f: number) => void; upload?: Upload } = {}): Promise<DmMedia> {
  const upload = opts.upload || defaultUpload
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const v = kind === 'image' ? await makeImageVariants(file) : null
  const main = v ? v.large : file
  // Progress: large image 85%, thumbnail 15%
  const up = await encryptUpload(key, main, upload, opts.onProgress && ((f) => opts.onProgress!(v ? f * 0.85 : f)))
  const thumb = v ? { ...(await encryptUpload(key, v.thumb, upload, opts.onProgress && ((f) => opts.onProgress!(0.85 + f * 0.15)))), mime: v.thumb.type } : undefined
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const m: DmMedia = { t: 'media', kind, url: up.url, key: b64(raw), iv: up.iv, mime: main.type || 'application/octet-stream', duration: opts.duration, size: main.size, ...(v && thumb ? { thumb, w: v.width, h: v.height } : {}) }
  if (typeof URL.createObjectURL === 'function') {
    cache.set(m.url, Promise.resolve(URL.createObjectURL(main)))
    if (v && thumb) cache.set(thumb.url, Promise.resolve(URL.createObjectURL(v.thumb)))
  }
  return m
}

/** Encrypt and upload; returns the string embeddable in a DM body (single file, legacy format) */
export async function encryptAndUpload(file: Blob, kind: DmMedia['kind'], duration?: number): Promise<string> {
  return mediaText(await encryptMedia(file, kind, { duration }))
}

/** One media descriptor → DM body */
export const mediaText = (m: DmMedia) => MARK + JSON.stringify(m)

/** Many → one DM body: outer is the first image (old app versions only know this one), items carries all */
export function albumText(items: DmMedia[]): string {
  if (items.length === 1) return mediaText(items[0])
  const first = { ...items[0] }
  delete first.items
  return MARK + JSON.stringify({ ...first, items: items.map((x) => { const c = { ...x }; delete c.items; return c }) })
}

const validItem = (x: unknown): x is DmMedia => {
  const m = x as DmMedia | null
  return !!m && m.t === 'media' && (m.kind === 'image' || m.kind === 'video') && typeof m.url === 'string' && typeof m.key === 'string' && typeof m.iv === 'string'
}
/** All media in one DM: multi-image messages use items (max 9); legacy messages are just themselves */
export function dmMediaItems(m: DmMedia): DmMedia[] {
  const list = Array.isArray(m.items) ? m.items.filter(validItem).slice(0, 9) : []
  return list.length ? list : [m]
}

export function parseDmMedia(text: string): DmMedia | null {
  if (!text.startsWith(MARK)) return null
  try { const m = JSON.parse(text.slice(MARK.length)) as DmMedia; return m.t === 'media' ? m : null } catch { return null }
}

async function decryptFile(url: string, keyB64: string, ivB64: string, mime: string) {
  // Ciphertext goes through the local media cache: still decryptable after the server's files expire, once viewed
  const ct = await (await cachedMediaBlob(SOCIAL_API + url)).arrayBuffer()
  const key = await crypto.subtle.importKey('raw', unb64(keyB64), { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, ct)
  return URL.createObjectURL(new Blob([plain], { type: mime }))
}
/** Clear in-memory decrypt results (test use; daily-clear mode may call it too) */
export function clearDecryptCache() { cache.clear() }
const cached = (url: string, run: () => Promise<string>) => {
  let hit = cache.get(url)
  if (!hit) { hit = run(); cache.set(url, hit); hit.catch(() => cache.delete(url)) }
  return hit
}
/** Download ciphertext and decrypt to a local object URL (memory only) */
export function decryptToUrl(m: DmMedia): Promise<string> {
  return cached(m.url, () => decryptFile(m.url, m.key, m.iv, m.mime))
}
/** Thumbnail for bubbles; legacy messages without one decrypt the original */
export function decryptThumbUrl(m: DmMedia): Promise<string> {
  const th = m.thumb
  return th && typeof th.url === 'string' && typeof th.iv === 'string' ? cached(th.url, () => decryptFile(th.url, m.key, th.iv, th.mime || 'image/webp')) : decryptToUrl(m)
}

export const mediaLabel = (m: DmMedia) => (dmMediaItems(m).length > 1 ? t('[图片] ×{n}', { n: dmMediaItems(m).length }) : m.kind === 'image' ? t('[图片]') : m.kind === 'video' ? t('[视频]') : t('[语音 {n} 秒]', { n: Math.round(m.duration || 0) }))
