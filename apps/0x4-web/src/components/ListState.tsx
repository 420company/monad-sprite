// Unified list appearance: empty states, load-more on scroll bottom, long-text truncation. Shared by community subpages (feed / messages / friends / rankings) and profile pages,
// where each list previously had its own version (some centered gray text, some with icons, some showing nothing) with inconsistent spacing and font sizes.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw, type LucideIcon } from 'lucide-react'
import Button from './Button'
import { t } from '@/lib/i18n'

/** Empty state: line icon + one line of text + optional extra description and button */
export function EmptyState({ icon: Icon, title, hint, action, className = '' }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`empty-state ${className}`} role="status">
      <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-72 text-xs leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * Load-more on scroll bottom: sits at the list's end, calls onMore when entering the viewport (600px early).
 * Re-observes after every load: when a page's content doesn't fill a screen, the sentinel stays in the viewport and would never fire again without re-observing.
 * Environments without IntersectionObserver fall back to a "load more" button.
 */
export function LoadMore({ onMore, loading, done, failed, onRetry, count }: { onMore: () => void; loading: boolean; done: boolean; failed: boolean; onRetry: () => void; count: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const io = typeof IntersectionObserver === 'function'
  useEffect(() => {
    const el = ref.current
    if (!el || !io || done || failed || loading) return
    const ob = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onMore() }, { rootMargin: '600px 0px' })
    ob.observe(el)
    return () => ob.disconnect()
  }, [io, done, failed, loading, count, onMore])
  if (done) return null
  return (
    <div ref={ref} className="flex min-h-14 items-center justify-center py-3 text-xs text-muted">
      {failed ? <button onClick={onRetry} className="flex min-h-11 items-center gap-1.5 px-3 text-accent"><RefreshCw size={14} />{t('加载失败，点这里重试')}</button>
        : loading ? <span className="flex items-center gap-1.5" role="status"><LoaderCircle size={14} className="animate-spin" />{t('加载中…')}</span>
          : !io && <Button size="sm" variant="secondary" onClick={onMore}>{t('加载更多')}</Button>}
    </div>
  )
}

/** Long text: truncated past lines lines, with an inline "view more" expander (text like comments and bios that doesn't deserve a detail page) */
export function MoreText({ text, lines = 4, className = '' }: { text: string; lines?: 3 | 4 | 6; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text, open])
  const clamp = open ? '' : lines === 3 ? 'line-clamp-3' : lines === 6 ? 'line-clamp-6' : 'line-clamp-4'
  return <>
    <p ref={ref} className={`whitespace-pre-wrap break-words ${clamp} ${className}`}>{text}</p>
    {over && !open && <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="mt-0.5 text-[13px] font-medium text-muted">{t('查看更多')}</button>}
  </>
}

/**
 * Pagination (2026-09-27 goat: community sections show at most 30 items per page — paginate instead of endless scrolling).
 * items can be a local full list or fetched in batches by usePaged: when loadMore / done are passed,
 * a page under 30 items auto-fetches more if the server has them; tapping "next page" fetches first when the local list is short.
 * reset changes (filter switched / data changed) return to page 1. After flipping, the list's start scrolls into view.
 */
export const LIST_PAGE = 30
export function usePager<T>(items: T[] | null | undefined, opts: { reset?: unknown; loadMore?: () => void; done?: boolean; loading?: boolean; failed?: boolean; size?: number } = {}) {
  const size = opts.size ?? LIST_PAGE
  const list = items || []
  const more = !!opts.loadMore && !opts.done
  const [page, setPage] = useState(0)
  const [want, setWant] = useState<number | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  useEffect(() => { setPage(0); setWant(null) }, [opts.reset])
  const localPages = Math.max(1, Math.ceil(list.length / size))
  const cur = Math.min(page, localPages - 1)
  const pageItems = list.slice(cur * size, cur * size + size)
  // Flip once the target page's data arrives; give up when the server says there's no more
  useEffect(() => {
    if (want == null) return
    if (list.length > want * size) { setPage(want); setWant(null) }
    else if (!more || opts.failed) setWant(null)
  }, [want, list.length, more, opts.failed, size])
  // Page underfilled and more exists: auto-fetch (usePaged's loadMore ignores itself while loading / at end / on failure)
  useEffect(() => {
    if (items && pageItems.length < size && more && !opts.loading && !opts.failed) opts.loadMore?.()
  }, [items, pageItems.length, size, more, opts.loading, opts.failed]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    anchor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [cur])
  const hasPrev = cur > 0
  const hasNext = (cur + 1) * size < list.length || more
  const go = (to: number) => {
    moved.current = true
    if (to * size < list.length) setPage(to)
    else if (more) { setWant(to); opts.loadMore?.() }
  }
  return { pageItems, page: cur, pages: more ? null : localPages, hasPrev, hasNext, waiting: want != null, prev: () => hasPrev && go(cur - 1), next: () => hasNext && go(cur + 1), anchor }
}

/** Pagination bar: previous / page numbers / next. Hidden with only one page */
export function Pager({ p, failed, onRetry, className = '' }: { p: ReturnType<typeof usePager<unknown>>; failed?: boolean; onRetry?: () => void; className?: string }) {
  if (!p.hasPrev && !p.hasNext && !failed) return null
  const btn = 'min-h-11 rounded-lg px-4 text-sm font-medium text-accent disabled:text-muted disabled:opacity-40'
  return (
    <nav className={`flex items-center justify-between gap-2 py-3 ${className}`} aria-label={t('翻页')}>
      <button onClick={p.prev} disabled={!p.hasPrev} className={btn}>{t('上一页')}</button>
      <span className="text-xs tabular-nums text-muted" role="status">
        {failed ? <button onClick={onRetry} className="flex min-h-11 items-center gap-1.5 px-3 text-accent"><RefreshCw size={14} />{t('加载失败，点这里重试')}</button>
          : p.waiting ? <span className="flex items-center gap-1.5"><LoaderCircle size={14} className="animate-spin" />{t('加载中…')}</span>
            : p.pages ? `${p.page + 1} / ${p.pages}` : t('第 {n} 页', { n: p.page + 1 })}
      </span>
      <button onClick={p.next} disabled={!p.hasNext || p.waiting} className={btn}>{t('下一页')}</button>
    </nav>
  )
}
