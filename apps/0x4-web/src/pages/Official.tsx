// "0x4 Official" announcements page (Community → entered from the top conversation in messages; push ref = announcement:<id> also lands here).
// Read-only: shows admins' broadcast announcements from the backend in chronological order (old on top, new at bottom, like chat) — no replies;
// A bottom row "questions? contact support" goes to the support page. Everything is marked read on entry; new arrivals are marked read immediately while staying on the page.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, ExternalLink, Headset, LoaderCircle, Megaphone, RefreshCw } from 'lucide-react'
import OfficialBadge from '@/components/OfficialBadge'
import PostImages from '@/components/PostImages'
import { OfficialAvatar } from '@/components/ChatList'
import { EmptyState } from '@/components/ListState'
import { toast } from '@/components/Toast'
import { useAnnouncements, type Announcement } from '@/store/announcements'
import { useSocial } from '@/store/social'
import { resolveImage } from '@/lib/postImage'
import { openExternal } from '@/lib/native'
import { timeAgo } from '@/lib/format'
import { useBack } from '@/lib/useBack'
import { t } from '@/lib/i18n'
import { needAccount } from '@/desktop/walletGate'
import { WEB_SURFACE } from '@/lib/surface'

export default function Official() {
  const back = useBack('/community')
  const status = useSocial((s) => s.status)
  const { list, loaded, failed, hasMore, loadingMore, unread } = useAnnouncements()
  const firstPaint = useRef(true)

  // Pull the latest once on entry (a push entry may not have pulled yet)
  useEffect(() => { if (status === 'ready') void useAnnouncements.getState().load() }, [status])
  // Being on this page = all seen: mark once on entry, mark new arrivals while staying
  useEffect(() => { if (status === 'ready' && loaded && unread > 0) void useAnnouncements.getState().markAllRead() }, [status, loaded, unread])
  // Scroll to the very bottom the first time there's content (latest item and "contact support" both visible; the bottom tab bar's height is yielded by Layout's bottom padding)
  useLayoutEffect(() => {
    if (!list.length || !firstPaint.current) return
    firstPaint.current = false
    // Wait for ScrollRestorer to finish the new page's "scroll to top" before scrolling
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }))
  }, [list.length])

  const ordered = [...list].reverse()   // Newest-first in the store, oldest-on-top on the page

  return (
    <div className="flex min-h-full flex-col pb-6">
      <header className="page-header page-gutter">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={back} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={22} /></button>
          <OfficialAvatar size={36} />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 text-lg font-bold"><span className="truncate">{t('0x4 官方')}</span><OfficialBadge size={17} label={t('0x4 官方认证')} /></h1>
            <p className="text-xs text-muted">{t('官方公告，不能回复')}</p>
          </div>
        </div>
      </header>

      <div className="page-gutter flex-1">
        {status !== 'ready' ? <div className="py-10 text-center"><p className="text-sm text-muted">{t('连接社交服务后可以查看公告')}</p>{WEB_SURFACE && <button type="button" onClick={() => { needAccount() }} className="mt-3 text-sm font-medium text-accent">{t('连接钱包')}</button>}</div>
          : failed && !loaded ? <div className="status-notice" role="status"><span className="flex-1">{t('暂时无法加载')}</span><button className="icon-button" onClick={() => void useAnnouncements.getState().load()} aria-label={t('重试')}><RefreshCw size={18} /></button></div>
          : !loaded ? <div className="space-y-3 py-2" role="status" aria-label={t('加载中…')}><div className="skeleton h-28" /><div className="skeleton h-40" /></div>
          : !list.length ? <EmptyState icon={Megaphone} title={t('暂时没有公告')} />
          : <>
            {hasMore && <div className="flex justify-center pb-2"><button onClick={() => void useAnnouncements.getState().loadMore()} disabled={loadingMore} className="text-action">{loadingMore && <LoaderCircle size={15} className="animate-spin" />}{t('查看更早的公告')}</button></div>}
            <ol className="space-y-5" aria-label={t('公告列表')}>
              {ordered.map((a) => <li key={a.id}><AnnouncementCard a={a} /></li>)}
            </ol>
          </>}
      </div>

      <p className="page-gutter mt-8 text-center text-[13px] text-muted">
        <Link to="/support" className="inline-flex min-h-11 items-center gap-1.5 text-accent"><Headset size={15} />{t('有问题请联系客服')}</Link>
      </p>
    </div>
  )
}

/** One announcement: time, title, body, image (tap for fullscreen), link button. The backend "broadcast" page's preview is drawn to match this */
export function AnnouncementCard({ a }: { a: Pick<Announcement, 'title' | 'body' | 'image' | 'link' | 'createdAt'> }) {
  const nav = useNavigate()
  const open = () => {
    if (!a.link) return
    // In-app routes jump directly; https opens in the system in-app browser
    if (a.link.startsWith('/')) nav(a.link)
    else openExternal(a.link).catch(() => toast.error(t('打开失败')))
  }
  let host = ''
  if (a.link && !a.link.startsWith('/')) { try { host = new URL(a.link).hostname } catch { /* Server-validated, never reaches here */ } }
  return (
    <article className="announcement-card" data-announcement="">
      <div className="mb-2 text-center text-[11px] text-muted"><time dateTime={new Date(a.createdAt).toISOString()}>{timeAgo(a.createdAt)}</time></div>
      <div className="overflow-hidden rounded-2xl bg-card2">
        {a.image && <PostImages images={[resolveImage({ url: a.image })]} mode="full" className="" />}
        <div className="px-4 py-3.5">
          {a.title && <h2 className="mb-1.5 text-[16px] font-semibold leading-snug">{a.title}</h2>}
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{a.body}</p>
        </div>
        {a.link && (
          <button onClick={open} className="flex min-h-12 w-full items-center gap-2 border-t border-line/60 px-4 text-left text-[14px] font-medium text-accent">
            {host ? <ExternalLink size={15} className="shrink-0" /> : null}
            <span className="flex-1 truncate">{t('查看详情')}{host && <span className="ml-1.5 text-xs font-normal text-muted">{host}</span>}</span>
            <ChevronRight size={17} className="shrink-0 text-muted" />
          </button>
        )}
      </div>
    </article>
  )
}
