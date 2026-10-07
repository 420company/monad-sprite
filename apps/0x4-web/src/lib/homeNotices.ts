// Home scrolling announcements (2026-09-29): official announcement titles scroll right of the 0x4 logo atop home; tap for full text.
// Server server/src/homeNotices.ts: public endpoint, returns only currently active ones, pinned first.
// Fetched once per home visit, cached for revisits within 5 minutes; on failure show nothing (top bar still shows 0x4), never affecting other home content.
import { useEffect, useState } from 'react'
import { api } from './social'

export interface HomeNotice { id: number; title: string; body: string; pinned: boolean; publishedAt: number }

export const CACHE_MS = 5 * 60_000

let cache: { at: number; list: HomeNotice[] } | null = null
let inflight: Promise<HomeNotice[]> | null = null

/** Fetch home announcements: use the cache when fresh, coalesce concurrent requests into one; on failure return the last result (empty when none) */
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

/** Test only: clear the cache */
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
