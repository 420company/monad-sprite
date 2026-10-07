// Minimal IndexedDB wrapper: local chat records (localChat) and media cache (mediaCache) share one database, 0x4-chat.
// Works in Capacitor's WKWebView / Android WebView and in browsers.
const DB_NAME = '0x4-chat'
const VERSION = 1

let opening: Promise<IDBDatabase> | null = null

export const idbAvailable = () => typeof indexedDB !== 'undefined'

export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION)
    r.onupgradeneeded = () => {
      const db = r.result
      // Chat records: k = conversation|message-id, the conv index fetches per conversation
      if (!db.objectStoreNames.contains('msgs')) db.createObjectStore('msgs', { keyPath: 'k' }).createIndex('conv', 'conv')
      // Encrypted per-conversation extras (the other party's profile, unread counts)
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' })
      // The web version's local encryption key (a non-exportable CryptoKey)
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys')
      // Media cache: url → blob
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'url' }).createIndex('at', 'at')
    }
    r.onsuccess = () => {
      r.result.onversionchange = () => { r.result.close(); opening = null }
      resolve(r.result)
    }
    r.onerror = () => { opening = null; reject(r.error) }
  })
  return opening
}

export const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

/** Run fn inside one transaction; return fn's result once the transaction completes */
export async function tx<T>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await openDb()
  const t = db.transaction(stores, mode)
  const done = new Promise<void>((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error) })
  const out = await fn(t)
  await done
  return out
}

/** Delete the whole database (when resetting the wallet) */
export async function dropDb(): Promise<void> {
  if (!idbAvailable()) return
  if (opening) { try { (await opening).close() } catch { /* ignore */ } opening = null }
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve() })
}
