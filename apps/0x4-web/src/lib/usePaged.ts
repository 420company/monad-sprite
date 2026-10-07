// 通用分页：第一页随 key 自动加载，滚到底（LoadMore 哨兵）再拉下一页。
// · key 变了 = 换了一份数据（切换关注流、换了筛选），旧数据清掉，迟到的旧响应丢弃
// · reload() = 同一份数据刷新（发帖后、点重试），新的第一页到了才替换，失败时继续显示旧的
// · 按 id 去重：翻页期间有新内容插到前面、或本地刚加的一条又出现在下一页，都不会重复
// · 传了 opts.cache：已加载的几页记在内存里；后退（POP）回到这个页面时直接用它，不重拉第一页，
//   这样加载更多翻到的第 N 页、滚动位置都还在（2026-09-26 goat：返回后回到首页状态）。新进入（PUSH）照常重拉
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigationType } from 'react-router-dom'

export interface Page<T> { items: T[]; next: string | null }
export type PageFetcher<T> = (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>

interface State<T> { key: string | null; items: T[] | null; next: string | null; done: boolean; loading: boolean; failed: false | 'first' | 'more' }

/** 后退时复用的分页缓存：超过这个时间的就不用了，重新拉 */
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
  /** 挂载时的导航类型：后退回来的才用缓存 */
  const mountNav = useRef(navType)
  /** 这个组件自己请求过没有：请求过（切了筛选、刷新过）就不再用缓存，免得切回来看到旧数据 */
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
        // 翻页却一条新的都没有 = 服务端没认游标（老版本）或者到头了，就此停下，免得哨兵一直可见时原地反复请求
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
      // 后退回来：原样用离开时的几页，不发请求（开发模式 StrictMode 会跑两次这里，两次都命中缓存）
      setS({ key, items: c.items as T[], next: c.next, done: c.done, loading: false, failed: false })
      return () => { gen.current++; ctrl.current?.abort() }
    }
    setS({ key, items: null, next: null, done: false, loading: !!key, failed: false })
    if (key) run('first', key)
    return () => { gen.current++; ctrl.current?.abort() }
  }, [key, run]) // eslint-disable-line react-hooks/exhaustive-deps

  // 每次数据变了都记一份（包括点赞之类的本地修改），后退回来时用
  useEffect(() => {
    if (cacheId && s.key === key && s.items && !s.loading) putPagedCache(cacheId, { items: s.items, next: s.next, done: s.done })
  }, [cacheId, key, s])

  const loadMore = useCallback(() => { const c = cur.current; if (c.key && !c.done && !c.loading && !c.failed && c.items) run('more', c.key) }, [run])
  const reload = useCallback(() => { const c = cur.current; if (c.key) run('first', c.key) }, [run])
  /** 失败后重试：哪一步失败就重做哪一步（刷新失败重拉第一页，翻页失败重拉那一页） */
  const retry = useCallback(() => { const c = cur.current; if (c.key) run(c.failed === 'more' && c.items ? 'more' : 'first', c.key) }, [run])
  const setItems = useCallback((fn: (list: T[]) => T[]) => setS((p) => (p.items ? { ...p, items: fn(p.items) } : p)), [])
  const items = s.key === key ? s.items : null
  // failed：第一页 / 刷新失败；moreFailed：翻页失败（列表底部显示重试）
  return { items, loading: s.loading, failed: s.failed === 'first', moreFailed: s.failed === 'more', done: s.done, loadMore, reload, retry, setItems }
}

/** 列表里最后一条 → 下一页游标（服务端约定「时间:id」）；这一页不满说明没有下一页 */
export const nextCursorOf = <T extends { id: string; createdAt: number }>(list: T[], limit: number): string | null => {
  const last = list[list.length - 1]
  return list.length >= limit && last ? `${last.createdAt}:${last.id}` : null
}
