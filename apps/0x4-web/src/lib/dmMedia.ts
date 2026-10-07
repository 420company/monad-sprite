// 私信媒体端到端加密：文件先用随机 AES-GCM 密钥在本机加密再上传，密钥放在（本身已加密的）私信正文里，服务器只见到密文二进制
import { SOCIAL_API, uploadFile } from './social'
import { t } from '@/lib/i18n'
import { makeImageVariants } from './imageCompress'
import { cachedMediaBlob } from './mediaCache'

/** thumb / w / h 是后加的：老消息没有，显示时回退用 url 那份。
 *  items 是多图消息（2026-09-26）：每张各自一把密钥、各自上传；外层字段就是第一张，旧版 App 至少能看到第一张 */
export interface DmMedia { t: 'media'; kind: 'image' | 'video' | 'voice'; url: string; key: string; iv: string; mime: string; duration?: number; size: number; thumb?: { url: string; iv: string; mime: string }; w?: number; h?: number; items?: DmMedia[] }
// 正文前缀：一个不可见控制字符 + dm:，普通文字不会以它开头
const MARK = String.fromCharCode(1) + 'dm:'
/** 媒体地址 → 解密后的本地 object URL（只在内存里） */
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
 * 加密并上传一个文件，返回媒体描述。图片先在本机压成大图 + 缩略图两份（同一把密钥、各自的 iv），原图不上传。
 * 上传完把本机那份登记进解密缓存，自己发的消息回显时直接显示，不用再下载解密。
 */
export async function encryptMedia(file: Blob, kind: DmMedia['kind'], opts: { duration?: number; onProgress?: (f: number) => void; upload?: Upload } = {}): Promise<DmMedia> {
  const upload = opts.upload || defaultUpload
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const v = kind === 'image' ? await makeImageVariants(file) : null
  const main = v ? v.large : file
  // 进度：大图占 85%，缩略图 15%
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

/** 加密并上传，返回可放进私信正文的字符串（单个文件，老格式） */
export async function encryptAndUpload(file: Blob, kind: DmMedia['kind'], duration?: number): Promise<string> {
  return mediaText(await encryptMedia(file, kind, { duration }))
}

/** 单个媒体描述 → 私信正文 */
export const mediaText = (m: DmMedia) => MARK + JSON.stringify(m)

/** 多张 → 一条私信正文：外层是第一张（旧版 App 只认得这一张），items 带全部 */
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
/** 一条私信里的全部媒体：多图消息取 items（最多 9 个），老消息就是它自己 */
export function dmMediaItems(m: DmMedia): DmMedia[] {
  const list = Array.isArray(m.items) ? m.items.filter(validItem).slice(0, 9) : []
  return list.length ? list : [m]
}

export function parseDmMedia(text: string): DmMedia | null {
  if (!text.startsWith(MARK)) return null
  try { const m = JSON.parse(text.slice(MARK.length)) as DmMedia; return m.t === 'media' ? m : null } catch { return null }
}

async function decryptFile(url: string, keyB64: string, ivB64: string, mime: string) {
  // 密文走本机媒体缓存：服务器上的文件过期后，看过的照样能解开
  const ct = await (await cachedMediaBlob(SOCIAL_API + url)).arrayBuffer()
  const key = await crypto.subtle.importKey('raw', unb64(keyB64), { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, ct)
  return URL.createObjectURL(new Blob([plain], { type: mime }))
}
/** 清掉内存里的解密结果（测试用；每天清空模式也可以调） */
export function clearDecryptCache() { cache.clear() }
const cached = (url: string, run: () => Promise<string>) => {
  let hit = cache.get(url)
  if (!hit) { hit = run(); cache.set(url, hit); hit.catch(() => cache.delete(url)) }
  return hit
}
/** 下载密文并解密成本地 object URL（只存在内存里） */
export function decryptToUrl(m: DmMedia): Promise<string> {
  return cached(m.url, () => decryptFile(m.url, m.key, m.iv, m.mime))
}
/** 气泡里用的缩略图；老消息没有缩略图就解原图 */
export function decryptThumbUrl(m: DmMedia): Promise<string> {
  const th = m.thumb
  return th && typeof th.url === 'string' && typeof th.iv === 'string' ? cached(th.url, () => decryptFile(th.url, m.key, th.iv, th.mime || 'image/webp')) : decryptToUrl(m)
}

export const mediaLabel = (m: DmMedia) => (dmMediaItems(m).length > 1 ? t('[图片] ×{n}', { n: dmMediaItems(m).length }) : m.kind === 'image' ? t('[图片]') : m.kind === 'video' ? t('[视频]') : t('[语音 {n} 秒]', { n: Math.round(m.duration || 0) }))
