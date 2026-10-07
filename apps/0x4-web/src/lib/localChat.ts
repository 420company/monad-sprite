// 本机聊天记录（「只存在这台手机」模式用）：群聊和私信都存在 IndexedDB，每条用本机密钥 AES-GCM 加密。
// 本机密钥：App 里放系统钥匙串（iOS 钥匙串 / Android Keystore，条目 chat-key），网页版是存在 IndexedDB 里的不可导出 CryptoKey。
// 换手机、删 App、重置钱包后密钥没了，记录也就读不出来了（这是用户选这个模式时确认过的）。
import { secureStore, persistentSession } from './secureStore'
import { idbAvailable, req, tx } from './idb'

/** 存储后端：库里只有密文。测试用内存实现，正式用 IndexedDB */
export interface EncRec { k: string; conv: string; ts: number; iv: Uint8Array; ct: Uint8Array }
export interface ChatBackend {
  put(recs: EncRec[]): Promise<void>
  byConv(conv: string): Promise<EncRec[]>
  /** 以 prefix 开头的全部会话 */
  convs(prefix: string): Promise<string[]>
  remove(keys: string[]): Promise<void>
  /** 删掉以 prefix 开头的所有会话 */
  removePrefix(prefix: string): Promise<void>
  getMeta(k: string): Promise<EncRec | undefined>
  putMeta(r: EncRec): Promise<void>
}

const bound = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '￿')

export const idbBackend: ChatBackend = {
  put: (recs) => tx('msgs', 'readwrite', (t) => { const s = t.objectStore('msgs'); for (const r of recs) s.put(r) }),
  byConv: (conv) => tx('msgs', 'readonly', (t) => req(t.objectStore('msgs').index('conv').getAll(conv) as IDBRequest<EncRec[]>)),
  // 只走索引键、每个会话一次（nextunique），不把密文读出来
  convs: (prefix) => tx('msgs', 'readonly', (t) => new Promise<string[]>((resolve, reject) => {
    const out: string[] = []
    const c = t.objectStore('msgs').index('conv').openKeyCursor(bound(prefix), 'nextunique')
    c.onsuccess = () => { const cur = c.result; if (!cur) return resolve(out); out.push(String(cur.key)); cur.continue() }
    c.onerror = () => reject(c.error)
  })),
  remove: (keys) => tx('msgs', 'readwrite', (t) => { const s = t.objectStore('msgs'); for (const k of keys) s.delete(k) }),
  removePrefix: (prefix) => tx(['msgs', 'meta'], 'readwrite', (t) => { t.objectStore('msgs').delete(bound(prefix)); t.objectStore('meta').delete(bound(prefix)) }),
  getMeta: (k) => tx('meta', 'readonly', (t) => req(t.objectStore('meta').get(k) as IDBRequest<EncRec | undefined>)),
  putMeta: (r) => tx('meta', 'readwrite', (t) => { t.objectStore('meta').put(r) }),
}

export function memoryBackend(): ChatBackend & { raw: Map<string, EncRec>; meta: Map<string, EncRec> } {
  const raw = new Map<string, EncRec>(), meta = new Map<string, EncRec>()
  return {
    raw, meta,
    async put(recs) { for (const r of recs) raw.set(r.k, r) },
    async byConv(conv) { return [...raw.values()].filter((r) => r.conv === conv) },
    async convs(prefix) { return [...new Set([...raw.values()].filter((r) => r.conv.startsWith(prefix)).map((r) => r.conv))] },
    async remove(keys) { for (const k of keys) raw.delete(k) },
    async removePrefix(prefix) { for (const k of [...raw.keys()]) if (k.startsWith(prefix)) raw.delete(k); for (const k of [...meta.keys()]) if (k.startsWith(prefix)) meta.delete(k) },
    async getMeta(k) { return meta.get(k) },
    async putMeta(r) { meta.set(r.k, r) },
  }
}

// ---------- 本机密钥 ----------

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const importRaw = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

/** 网页版：不可导出的密钥存在 IndexedDB（结构化克隆能存 CryptoKey，JS 拿不到原始字节） */
async function idbKey(): Promise<CryptoKey> {
  const saved = await tx('keys', 'readonly', (t) => req(t.objectStore('keys').get('chat') as IDBRequest<CryptoKey | undefined>))
  if (saved) return saved
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await tx('keys', 'readwrite', (t) => { t.objectStore('keys').put(k, 'chat') })
  return k
}

/** App：原始密钥放钥匙串，读出来导入成不可导出的 CryptoKey。钥匙串写不进去（老版本原生层不认这个条目）就退回网页的办法 */
async function nativeKey(): Promise<CryptoKey> {
  const saved = await secureStore.get('chat-key')
  if (saved) return importRaw(unb64(saved))
  const raw = crypto.getRandomValues(new Uint8Array(32))
  await secureStore.set('chat-key', b64(raw))
  if ((await secureStore.get('chat-key')) === b64(raw)) return importRaw(raw)
  return idbKey()
}

let keyPromise: Promise<CryptoKey> | null = null
export function chatKey(): Promise<CryptoKey> {
  keyPromise ||= (persistentSession ? nativeKey() : idbKey()).catch((e) => { keyPromise = null; throw e })
  return keyPromise
}
/** 重置钱包后密钥作废 */
export const forgetChatKey = () => { keyPromise = null }

// ---------- 加解密的会话存储 ----------

export interface LocalMsg { id: string; ts: number }

/**
 * 按「所有者地址」分开存：同一台设备换了钱包，互相看不到。
 * 会话键：<owner>|g|<群id>、<owner>|d|<对方地址>
 */
export class LocalChat {
  constructor(private backend: ChatBackend, private key: () => Promise<CryptoKey>) {}

  static conv(owner: string, kind: 'g' | 'd', id: string) { return `${owner}|${kind}|${id}` }

  private async seal(k: string, value: unknown): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(k) }, await this.key(), new TextEncoder().encode(JSON.stringify(value)))
    return { iv, ct: new Uint8Array(ct) }
  }
  private async open<T>(r: EncRec): Promise<T> {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource, additionalData: new TextEncoder().encode(r.k) }, await this.key(), r.ct as BufferSource)
    return JSON.parse(new TextDecoder().decode(pt)) as T
  }

  async save<T extends LocalMsg>(conv: string, msgs: T[]): Promise<void> {
    if (!msgs.length) return
    const recs = await Promise.all(msgs.map(async (m) => {
      const k = `${conv}|${m.id}`
      return { k, conv, ts: m.ts, ...(await this.seal(k, m)) }
    }))
    await this.backend.put(recs)
  }

  /** 一个会话的全部记录，按时间正序；解不开的（密钥换了）跳过 */
  async load<T extends LocalMsg>(conv: string): Promise<T[]> {
    const recs = await this.backend.byConv(conv)
    const out: T[] = []
    for (const r of recs) { try { out.push(await this.open<T>(r)) } catch { /* 密钥不对，跳过 */ } }
    return out.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /** owner 名下某类会话的 id 列表（私信 = 对方地址） */
  async list(owner: string, kind: 'g' | 'd'): Promise<string[]> {
    const prefix = `${owner}|${kind}|`
    return (await this.backend.convs(prefix)).map((c) => c.slice(prefix.length))
  }

  remove(conv: string, ids: string[]) { return this.backend.remove(ids.map((id) => `${conv}|${id}`)) }
  clearConv(conv: string) { return this.backend.removePrefix(`${conv}|`) }
  /** 清掉 owner 名下全部记录和附加信息 */
  clearOwner(owner: string) { return this.backend.removePrefix(`${owner}|`) }

  async getMeta<T>(owner: string, name: string): Promise<T | null> {
    const r = await this.backend.getMeta(`${owner}|meta|${name}`)
    if (!r) return null
    try { return await this.open<T>(r) } catch { return null }
  }
  async setMeta(owner: string, name: string, value: unknown): Promise<void> {
    const k = `${owner}|meta|${name}`
    await this.backend.putMeta({ k, conv: k, ts: Date.now(), ...(await this.seal(k, value)) })
  }
}

/** 正式用的实例：IndexedDB + 本机密钥。没有 IndexedDB 的环境（测试、极老的浏览器）为 null */
export const localChat: LocalChat | null = idbAvailable() ? new LocalChat(idbBackend, chatKey) : null
