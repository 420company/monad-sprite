// 列表的统一外观：空状态、滚到底加载更多、长文本截断。社区下各子页面（动态 / 消息 / 好友 / 排行）和个人主页共用，
// 以前每个列表各写一套（有的居中灰字、有的带图标、有的什么都不显示），间距和字号都不一样。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw, type LucideIcon } from 'lucide-react'
import Button from './Button'
import { t } from '@/lib/i18n'

/** 空状态：线条图标 + 一句话 + 可选的补充说明和按钮 */
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
 * 滚到底加载更多：放在列表最后，进入视口（提前 600px）就调 onMore。
 * 每次加载结束都重新观察一次：一页内容不满一屏时哨兵一直在视口里，不重新观察就不会再触发。
 * 没有 IntersectionObserver 的环境退回成一个「加载更多」按钮。
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

/** 长文本：超过 lines 行截断，末尾「查看更多」原地展开（评论、简介这类不值得跳详情页的文字） */
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
 * 翻页（2026-09-27 goat：社区各子版块每页最多 30 条，多了点翻页，不要一直往下滚）。
 * items 可以是本地的全量列表，也可以是 usePaged 分批拉来的：传 loadMore / done 时，
 * 本页不满 30 条且服务器还有就自动补拉；点「下一页」时本地不够也先去拉。
 * reset 变了（切了筛选 / 换了数据）回到第 1 页。翻页后把列表开头滚进视口。
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
  // 等着翻过去的那一页数据到了就翻；服务器说没有了就作罢
  useEffect(() => {
    if (want == null) return
    if (list.length > want * size) { setPage(want); setWant(null) }
    else if (!more || opts.failed) setWant(null)
  }, [want, list.length, more, opts.failed, size])
  // 本页不满且还有更多：自动补拉（usePaged 的 loadMore 在加载中 / 已到底 / 失败时自己会忽略）
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

/** 翻页条：上一页 / 页码 / 下一页。只有一页时不显示 */
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
