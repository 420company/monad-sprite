// 「0x4 官方」公告页（社区 → 消息最上面那个会话点进来，推送 ref = announcement:<id> 也到这里）。
// 只读：按时间顺序（旧的在上、新的在下，和聊天一样）显示管理员在后台发的全员公告，不能回复；
// 底部一行「有问题请联系客服」去联系客服页。进来即全部标记已读，停在页面上时新来的也立刻标已读。
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

  // 进来先拉一次最新的（推送点进来时可能还没拉过）
  useEffect(() => { if (status === 'ready') void useAnnouncements.getState().load() }, [status])
  // 在这个页面上 = 都看过了：进来标一次，停留时新来的也标
  useEffect(() => { if (status === 'ready' && loaded && unread > 0) void useAnnouncements.getState().markAllRead() }, [status, loaded, unread])
  // 第一次有内容时滚到最底下（最新一条和「联系客服」都露出来；底部导航栏的高度由 Layout 的下内边距让出来）
  useLayoutEffect(() => {
    if (!list.length || !firstPaint.current) return
    firstPaint.current = false
    // 等 ScrollRestorer 处理完新页面的「回到顶部」再滚
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }))
  }, [list.length])

  const ordered = [...list].reverse()   // store 里新的在前，页面上旧的在上

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

/** 一条公告：时间、标题、正文、配图（点开全屏）、链接按钮。后台「全员公告」页的预览照这个样子画 */
export function AnnouncementCard({ a }: { a: Pick<Announcement, 'title' | 'body' | 'image' | 'link' | 'createdAt'> }) {
  const nav = useNavigate()
  const open = () => {
    if (!a.link) return
    // App 内路由直接跳；https 用系统内置浏览器打开
    if (a.link.startsWith('/')) nav(a.link)
    else openExternal(a.link).catch(() => toast.error(t('打开失败')))
  }
  let host = ''
  if (a.link && !a.link.startsWith('/')) { try { host = new URL(a.link).hostname } catch { /* 服务端校验过，不会走到这 */ } }
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
