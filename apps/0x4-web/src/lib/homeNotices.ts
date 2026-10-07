// 首页滚动公告（2026-09-29）：首页顶部 0x4 logo 右边滚动显示官方公告标题，点开看全文。
// 服务端 server/src/homeNotices.ts：公开接口，只返回现在生效的，置顶在前。
// 进首页拉一次，5 分钟内再进首页用缓存；拉失败什么都不显示（顶栏照常显示 0x4），不影响首页其它内容。
import { useEffect, useState } from 'react'
import { api } from './social'

export interface HomeNotice { id: number; title: string; body: string; pinned: boolean; publishedAt: number }

export const CACHE_MS = 5 * 60_000

let cache: { at: number; list: HomeNotice[] } | null = null
let inflight: Promise<HomeNotice[]> | null = null

/** 拿首页公告：缓存没过期直接用，同时进来的请求合并成一个；失败返回上次的结果（没有就是空） */
export function loadHomeNotices(now = Date.now()): Promise<HomeNotice[]> {
  if (cache && now - cache.at < CACHE_MS) return Promise.resolve(cache.list)
  inflight ??= api<{ list?: HomeNotice[] }>('/api/home-notices')
    .then((r) => {
      const list = Array.isArray(r?.list) ? r.list.filter((n) => n && typeof n.title === 'string' && typeof n.body === 'string') : []
      cache = { at: Date.now(), list }
      return list
    })
    .catch(() => cache?.list ?? [])
    .finally(() => { inflight = null })
  return inflight
}

/** 测试用：清掉缓存 */
export function resetHomeNotices() { cache = null; inflight = null }

export function useHomeNotices(): HomeNotice[] {
  const [list, setList] = useState<HomeNotice[]>(() => cache?.list ?? [])
  useEffect(() => {
    let alive = true
    loadHomeNotices().then((l) => { if (alive) setList(l) })
    return () => { alive = false }
  }, [])
  return list
}
