// Generic pagination: the first page auto-loads with the key; hitting the bottom (LoadMore sentinel) pulls the next page.
// · key changed = a different dataset (feed switched, filter changed): clear old data, discard late old responses
// · reload() = refresh of the same dataset (after posting, on retry): swap only when the new first page arrives; keep showing the old one on failure
// · Dedupe by id: new content inserted at the top mid-pagination, or a locally-added item reappearing on the next page, never duplicates
// · With opts.cache: loaded pages are memoized in memory; going back (POP) to this page reuses them instead of refetching page one,
//   so the Nth page reached via load-more and the scroll position survive (2026-09-26 goat: it used to reset to the home state on return). Fresh entries (PUSH) refetch as usual
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigationType } from 'react-router-dom'

export interface Page<T> { items: T[]; next: string | null }
export type PageFetcher<T> = (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>

interface State<T> { key: string | null; items: T[] | null; next: string | null; done: boolean; loading: boolean; failed: false | 'first' | 'more' }

/** Paged cache reused on back-nav: entries older than this are discarded and refetched */
export const PAGED_CACHE_TTL = 10 * 60_000
const PAGED_CACHE_MAX = 30
interface Cached { items: unknown[]; next: string | null; done: boolean; at: number }
const pagedCache = new Map<string, Cached>()
export function putPagedCache(id: string, v: Omit<Cached, 'at'>, now = Date.now()) {
  pagedCache.delete(id); pagedCache.set(id, { ...v, at: now })
  while (pagedCache.size > PAGED_CACHE_MAX) pagedCache.delete(pagedCache.keys().next().value as string)
}
export function takePagedCache(id: string, now = Date.now()): Cached | null {
  const c = pagedCache.get(id)
  if (!c) return null
  if (now - c.at > PAGED_CACHE_TTL) { pagedCache.delete(id); return null }
  return c
}
export const clearPagedCache = () => pagedCache.clear()

export function usePaged<T>(key: string | null, fetchPage: PageFetcher<T>, idOf: (x: T) => string, opts?: { cache?: string }) {
  const navType = useNavigationType()
  /** Navigation type at mount: the cache is only used when coming back */
  const mountNav = useRef(navType)
  /** Whether this component has requested on its own: once it has (filter changed, refreshed), the cache is no longer used — no stale data on return */
  const fetched = useRef(false)
  const cacheId = opts?.cache && key ? `${opts.cache}|${key}` : null
  const [s, setS] = useState<State<T>>(() => {
    const c = cacheId && mountNav.current === 'POP' ? takePagedCache(cacheId) : null
    return c ? { key, items: c.items as T[], next: c.next, done: c.done, loading: false, failed: false } : { key, items: null, next: null, done: false, loading: !!key, failed: false }
  })
  const gen = useRef(0)
  const busy = useRef(false)
  const ctrl = useRef<AbortController | null>(null)
  const fetchRef = useRef(fetchPage); fetchRef.current = fetchPage
  const idRef = useRef(idOf); idRef.current = idOf
  const cur = useRef(s); cur.current = s

  const run = useCallback((mode: 'first' | 'more', k: string | null) => {
    if (!k) return
    if (mode === 'more' && busy.current) return
    fetched.current = true
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    const my = ++gen.current
    busy.current = true
    setS((p) => ({ ...p, loading: true, failed: false }))
    const timeout = setTimeout(() => c.abort(), 15_000)
    fetchRef.current(mode === 'first' ? null : cur.current.next, c.signal).then((page) => {
      if (my !== gen.current) return
      if (!page || !Array.isArray(page.items)) throw new Error('bad page')
      setS((p) => {
        const base = mode === 'first' ? [] : p.items || []
        const seen = new Set(base.map((x) => idRef.current(x)))
        const fresh = page.items.filter((x) => { const id = idRef.current(x); if (seen.has(id)) return false; seen.add(id); return true })
        // A page with zero new items = the server didn't honor the cursor (old version) or the end is reached: stop here, so a permanently-visible sentinel doesn't refetch in place
        const stuck = mode === 'more' && !fresh.length
        return { key: k, items: [...base, ...fresh], next: page.next, done: !page.next || stuck, loading: false, failed: false }
      })
    }).catch(() => {
      if (my !== gen.current) return
      setS((p) => ({ ...p, loading: false, failed: mode }))
    }).finally(() => { clearTimeout(timeout); if (my === gen.current) busy.current = false })
  }, [])

  useEffect(() => {
    gen.current++; busy.current = false; ctrl.current?.abort()
    const c = cacheId && !fetched.current && mountNav.current === 'POP' ? takePagedCache(cacheId) : null
    if (c) {
      // Coming back: reuse the pages as left, no requests (dev StrictMode runs this twice — both hit the cache)
      setS({ key, items: c.items as T[], next: c.next, done: c.done, loading: false, failed: false })
      return () => { gen.current++; ctrl.current?.abort() }
    }
    setS({ key, items: null, next: null, done: false, loading: !!key, failed: false })
    if (key) run('first', key)
    return () => { gen.current++; ctrl.current?.abort() }
  }, [key, run]) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize on every data change (including local edits like likes) for the trip back
  useEffect(() => {
    if (cacheId && s.key === key && s.items && !s.loading) putPagedCache(cacheId, { items: s.items, next: s.next, done: s.done })
  }, [cacheId, key, s])

  const loadMore = useCallback(() => { const c = cur.current; if (c.key && !c.done && !c.loading && !c.failed && c.items) run('more', c.key) }, [run])
  const reload = useCallback(() => { const c = cur.current; if (c.key) run('first', c.key) }, [run])
  /** Retry after failure: redo exactly the failed step (failed refresh refetches page one, failed page-turn refetches that page) */
  const retry = useCallback(() => { const c = cur.current; if (c.key) run(c.failed === 'more' && c.items ? 'more' : 'first', c.key) }, [run])
  const setItems = useCallback((fn: (list: T[]) => T[]) => setS((p) => (p.items ? { ...p, items: fn(p.items) } : p)), [])
  const items = s.key === key ? s.items : null
  // failed: page-one / refresh failed; moreFailed: page-turn failed (retry shown at the list bottom)
  return { items, loading: s.loading, failed: s.failed === 'first', moreFailed: s.failed === 'more', done: s.done, loadMore, reload, retry, setItems }
}

/** Last item in the list → next-page cursor (server convention "time:id"); a short page means there's no next page */
export const nextCursorOf = <T extends { id: string; createdAt: number }>(list: T[], limit: number): string | null => {
  const last = list[list.length - 1]
  return list.length >= limit && last ? `${last.createdAt}:${last.id}` : null
}
