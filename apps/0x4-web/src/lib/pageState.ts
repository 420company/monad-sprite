// In-session memory for page UI state: tabs, filters, sorting, search terms, loaded counts, that sort of thing.
// These used to be useState in components — unmounting the page (tapping into a detail page) dropped them, and going back returned to a default "home state" (2026-09-26 goat feedback).
// · Lives in memory, mirrored to one sessionStorage key (0x4.pageState): survives reloads after the OS reclaims the WebView, cleared when the app closes
// · Entry count is capped with least-recently-used eviction (per-object state like token details and profile pages would otherwise pile up)
// · Read-back values pass validation first; corrupted or unrecognized legacy values all fall back to defaults
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

export const PAGE_STATE_KEY = '0x4.pageState'
export const PAGE_STATE_MAX = 200

type Entry = [string, unknown]

export interface PageStateStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
  size(): number
}

/** storage = null means memory-only (tests, storage unavailable) */
export function createPageStateStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null, max = PAGE_STATE_MAX): PageStateStore {
  const map = new Map<string, unknown>()
  try {
    const raw = storage?.getItem(PAGE_STATE_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(list)) for (const e of list) if (Array.isArray(e) && typeof e[0] === 'string') map.set(e[0], e[1])
  } catch { /* Corrupted: treat as empty */ }
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    try { storage?.setItem(PAGE_STATE_KEY, JSON.stringify([...map.entries()] as Entry[])) } catch { /* Failing to persist only affects post-reload restoration */ }
  }
  // Don't serialize on every keystroke while typing a search term
  const schedule = () => { if (storage && !timer) timer = setTimeout(flush, 150) }
  return {
    get: (key) => {
      if (!map.has(key)) return undefined
      const v = map.get(key)
      map.delete(key); map.set(key, v)   // Move to most-recent
      return v
    },
    set: (key, value) => {
      if (map.get(key) === value && map.has(key)) return
      map.delete(key); map.set(key, value)
      while (map.size > max) map.delete(map.keys().next().value as string)
      schedule()
    },
    delete: (key) => { if (map.delete(key)) schedule() },
    clear: () => { map.clear(); try { storage?.removeItem(PAGE_STATE_KEY) } catch { /* Ignore */ } },
    size: () => map.size,
  }
}

const sessionStore = (() => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null } })()
export const pageStore = createPageStateStore(sessionStore)

/** Validator: the value must be one of the given options */
export const oneOf = <T extends string | number>(...values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
export const isString = (v: unknown): v is string => typeof v === 'string'
/** Positive integer, at most max (for loaded counts etc., guarding against astronomical values) */
export const posInt = (max = 10_000) => (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** Read a remembered value; use the default when absent / invalid */
export function readPageState<T>(key: string, initial: T | (() => T), valid?: (v: unknown) => v is T, store: PageStateStore = pageStore): T {
  const v = store.get(key)
  if (v !== undefined && (!valid || valid(v))) return v as T
  return typeof initial === 'function' ? (initial as () => T)() : initial
}

/** Used just like useState, except the value lives in the session: the page comes back as it was after unmounting. When the key changes (different token, different person), read what that key remembered */
export function usePageState<T>(key: string, initial: T | (() => T), valid?: (v: unknown) => v is T): [T, Dispatch<SetStateAction<T>>] {
  const [s, setS] = useState(() => ({ key, value: readPageState(key, initial, valid) }))
  let value = s.value
  if (s.key !== key) {
    value = readPageState(key, initial, valid)
    setS({ key, value })   // Sync once during render for the new key (a React-sanctioned pattern)
  }
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setS((prev) => {
      const base = prev.key === key ? prev.value : readPageState(key, initial, valid)
      const v = typeof next === 'function' ? (next as (p: T) => T)(base) : next
      pageStore.set(key, v)
      return { key, value: v }
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set]
}
