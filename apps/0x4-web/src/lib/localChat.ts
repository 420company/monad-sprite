// On-device chat history (for the "only on this phone" mode): groups and DMs both live in IndexedDB, each message AES-GCM-encrypted with the device key.
// Device key: kept in the OS keychain in the app (iOS Keychain / Android Keystore, entry chat-key); on web it's a non-exportable CryptoKey stored in IndexedDB.
// Switch phones, delete the app, or reset the wallet and the key is gone — the history becomes unreadable (the user acknowledged this when choosing the mode).
import { secureStore, persistentSession } from './secureStore'
import { idbAvailable, req, tx } from './idb'

/** Storage backend: only ciphertext in the store. In-memory for tests, IndexedDB in production */
export interface EncRec { k: string; conv: string; ts: number; iv: Uint8Array; ct: Uint8Array }
export interface ChatBackend {
  put(recs: EncRec[]): Promise<void>
  byConv(conv: string): Promise<EncRec[]>
  /** All conversations starting with prefix */
  convs(prefix: string): Promise<string[]>
  remove(keys: string[]): Promise<void>
  /** Delete all conversations starting with prefix */
  removePrefix(prefix: string): Promise<void>
  getMeta(k: string): Promise<EncRec | undefined>
  putMeta(r: EncRec): Promise<void>
}

const bound = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '￿')

export const idbBackend: ChatBackend = {
  put: (recs) => tx('msgs', 'readwrite', (t) => { const s = t.objectStore('msgs'); for (const r of recs) s.put(r) }),
  byConv: (conv) => tx('msgs', 'readonly', (t) => req(t.objectStore('msgs').index('conv').getAll(conv) as IDBRequest<EncRec[]>)),
  // Walk index keys only, once per conversation (nextunique) — ciphertext is never read out
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

// ---------- Device key ----------

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const importRaw = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

/** Web: the non-exportable key lives in IndexedDB (structured clone can store a CryptoKey; JS never sees the raw bytes) */
async function idbKey(): Promise<CryptoKey> {
  const saved = await tx('keys', 'readonly', (t) => req(t.objectStore('keys').get('chat') as IDBRequest<CryptoKey | undefined>))
  if (saved) return saved
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await tx('keys', 'readwrite', (t) => { t.objectStore('keys').put(k, 'chat') })
  return k
}

/** App: the raw key goes in the keychain, read out and imported as a non-exportable CryptoKey. When the keychain is unwritable (old native builds don't recognize this entry), fall back to the web approach */
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
/** The key is voided after a wallet reset */
export const forgetChatKey = () => { keyPromise = null }

// ---------- Encrypted conversation store ----------

export interface LocalMsg { id: string; ts: number }

/**
 * Stored separately per "owner address": switching wallets on the same device keeps them mutually invisible.
 * Conversation keys: <owner>|g|<group id>, <owner>|d|<peer address>
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

  /** A conversation's full history, chronological; undecryptable entries (key changed) are skipped */
  async load<T extends LocalMsg>(conv: string): Promise<T[]> {
    const recs = await this.backend.byConv(conv)
    const out: T[] = []
    for (const r of recs) { try { out.push(await this.open<T>(r)) } catch { /* Key mismatch — skip */ } }
    return out.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /** ID list of one conversation kind under an owner (DMs = peer addresses) */
  async list(owner: string, kind: 'g' | 'd'): Promise<string[]> {
    const prefix = `${owner}|${kind}|`
    return (await this.backend.convs(prefix)).map((c) => c.slice(prefix.length))
  }

  remove(conv: string, ids: string[]) { return this.backend.remove(ids.map((id) => `${conv}|${id}`)) }
  clearConv(conv: string) { return this.backend.removePrefix(`${conv}|`) }
  /** Clear all records and extras under an owner */
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

/** The production instance: IndexedDB + device key. Null in environments without IndexedDB (tests, ancient browsers) */
export const localChat: LocalChat | null = idbAvailable() ? new LocalChat(idbBackend, chatKey) : null
