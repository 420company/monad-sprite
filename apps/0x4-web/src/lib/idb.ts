// 极简 IndexedDB 封装：本机聊天记录（localChat）和媒体缓存（mediaCache）共用一个库 0x4-chat。
// Capacitor 的 WKWebView / Android WebView 和浏览器都能用。
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
      // 聊天记录：k = 会话|消息id，conv 索引按会话取
      if (!db.objectStoreNames.contains('msgs')) db.createObjectStore('msgs', { keyPath: 'k' }).createIndex('conv', 'conv')
      // 加密后的会话附加信息（对方资料、未读数）
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' })
      // 网页版的本地加密密钥（不可导出的 CryptoKey）
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys')
      // 媒体缓存：url → blob
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

/** 在一个事务里跑 fn，事务完成后返回 fn 的结果 */
export async function tx<T>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await openDb()
  const t = db.transaction(stores, mode)
  const done = new Promise<void>((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error) })
  const out = await fn(t)
  await done
  return out
}

/** 整个库删掉（重置钱包时） */
export async function dropDb(): Promise<void> {
  if (!idbAvailable()) return
  if (opening) { try { (await opening).close() } catch { /* ignore */ } opening = null }
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve() })
}
