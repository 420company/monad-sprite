// Comments (redone 2026-09-25, modeled on Instagram / X):
// · One comment = avatar + nickname + time on one line, body on the next, small heart + like count on the right; no more big gray frame
// · Delete / report / copy tuck into the "…" menu (long-press the body also works). Who can delete: the comment author, the post author, support / admins
// · Under posts in the feed, profiles, and token pages: at most 2 comments shown (most-liked first, else newest) + "view all N comments" + a "write a comment…" entry,
//   tapping in opens the full conversation page (PostDetail: all comments paged + bottom input)
import { useState } from 'react'
import { openReport } from '@/lib/safety'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, Flag, Heart, MoreHorizontal, Trash2 } from 'lucide-react'
import Avatar from './Avatar'
import XBadge from './XBadge'
import MessageMenu, { useLongPress, type MenuAnchor, type MenuItem } from './MessageMenu'
import { MoreText } from './ListState'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { copyText } from '@/lib/native'
import { timeAgo } from '@/lib/format'
import { previewComments, type Comment } from '@/lib/comments'
import { useSocial, displayName } from '@/store/social'
import { canModerate, useStaffRole } from '@/lib/staff'
import { t } from '@/lib/i18n'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

/** Confirmation copy before deleting a post / comment: deleting your own as usual; support deleting others' must state the author will be notified */
export const confirmDeleteText = (own: boolean, what: 'post' | 'comment') => own
  ? (what === 'post' ? t('删除这条动态？') : t('删除这条评论？'))
  : (what === 'post' ? t('这条动态违反社区规范，确定删除？作者会收到通知。') : t('这条评论违反社区规范，确定删除？作者会收到通知。'))

/** Open a post's full conversation page; compose = focus the input right after entering */
export const postPath = (id: string) => `/post/${encodeURIComponent(id)}`

const setCommentLike = (postId: string, commentId: string, on: boolean) =>
  api<{ likes: number; likedByMe: boolean }>(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/like`, { method: on ? 'POST' : 'DELETE' })

export function CommentRow({ c, postId, postAuthor, onChange, onRemove }: { c: Comment; postId: string; postAuthor: string; onChange: (c: Comment) => void; onRemove: (id: string) => void }) {
  const { me, status } = useSocial()
  const staffRole = useStaffRole()
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const press = useLongPress(setMenu)
  const own = !!me && c.author === me.address
  const mineToManage = !!me && postAuthor === me.address
  const canDelete = own || mineToManage || canModerate(staffRole)
  const name = displayName({ address: c.author, nickname: c.nickname })

  const like = async () => {
    if (busy) return
    if (status !== 'ready') return toast.info(t('连接社交服务后可以点赞'))
    const on = !c.likedByMe
    setBusy(true)
    onChange({ ...c, likedByMe: on, likes: Math.max(0, c.likes + (on ? 1 : -1)) }) // Update the UI first, roll back on failure
    try { const r = await setCommentLike(postId, c.id, on); onChange({ ...c, likedByMe: r.likedByMe, likes: r.likes }) }
    catch (e) { onChange(c); toast.error(errorText(e, t('点赞失败，请重试'))) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setMenu(null)
    // Deleting your own deletes directly (old behavior); post authors deleting others' get asked once; support deleting others' explains the author will be notified
    if (!own && !confirm(confirmDeleteText(mineToManage, 'comment'))) return
    try { await api(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); onRemove(c.id); toast.success(t('已删除')) }
    catch (e) { toast.error(errorText(e, t('删除失败'))) }
  }
  // Reports go through the unified report sheet (pick a reason, can block along the way); support's backend can see the comment's original text
  const report = () => { setMenu(null); openReport({ kind: 'comment', id: c.id, target: c.author, name: c.nickname || undefined }) }
  const items: MenuItem[] = [
    { key: 'copy', label: t('复制'), icon: <Copy size={17} />, onSelect: () => { setMenu(null); void copyText(c.text).then(() => toast.success(t('已复制'))) } },
    ...(status === 'ready' && me && !own ? [{ key: 'report', label: t('举报'), icon: <Flag size={17} />, onSelect: () => report() }] : []),
    ...(canDelete ? [{ key: 'delete', label: t('删除'), icon: <Trash2 size={17} />, danger: true, onSelect: () => void remove() }] : []),
  ]
  const openMenu = (e: React.MouseEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }) }

  return (
    <div className="flex items-start gap-2.5 py-2" data-comment={c.id}>
      <Link to={`/u/${c.author}`} className="shrink-0 pt-0.5" aria-label={t('{name}的主页', { name })}><Avatar address={c.author} src={c.avatar} name={c.nickname} size={28} /></Link>
      <div className="min-w-0 flex-1" {...press}>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5">
          <Link to={`/u/${c.author}`} className="min-w-0 truncate font-semibold"><UserName address={c.author} name={name} /></Link>
          <XBadge address={c.author} size={11} />
          <time className="shrink-0 text-xs text-muted" dateTime={new Date(c.createdAt).toISOString()}>{timeAgo(c.createdAt)}</time>
          <button type="button" onClick={openMenu} className="-my-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-card2" aria-label={t('评论操作')} aria-haspopup="menu"><MoreHorizontal size={16} /></button>
        </div>
        <MoreText text={c.text} className="text-[14px] leading-relaxed" />
      </div>
      <button type="button" onClick={() => void like()} disabled={busy} aria-pressed={c.likedByMe} aria-label={c.likedByMe ? t('取消点赞') : t('点赞')}
        className={`-mr-2 flex min-h-11 w-10 shrink-0 flex-col items-center pt-1 ${c.likedByMe ? 'text-down' : 'text-muted'}`}>
        <Heart size={14} fill={c.likedByMe ? 'currentColor' : 'none'} />
        <span className="number mt-0.5 min-h-4 text-[11px] leading-4">{c.likes || ''}</span>
      </button>
      <MessageMenu anchor={menu} items={items} onClose={() => setMenu(null)} label={t('评论操作')} />
    </div>
  )
}

interface PreviewPost { id: string; author: string; comments?: number; topComments?: Comment[] }

/**
 * Comment preview under a post: at most 2 + "view all N comments" + a lightweight "write a comment…" entry.
 * onPatch writes local changes (likes, deletes) back into that post in the list.
 */
export function CommentPreview({ post, onPatch }: { post: PreviewPost; onPatch: (patch: Partial<PreviewPost>) => void }) {
  const nav = useNavigate()
  const { me, status } = useSocial()
  const all = post.topComments || []
  const shown = previewComments(all)
  const total = Math.max(post.comments || 0, shown.length)
  return (
    <div className="mt-0.5">
      {shown.map((c) => <CommentRow key={c.id} c={c} postId={post.id} postAuthor={post.author}
        onChange={(n) => onPatch({ topComments: all.map((x) => (x.id === n.id ? n : x)) })}
        onRemove={(id) => onPatch({ topComments: all.filter((x) => x.id !== id), comments: Math.max(0, total - 1) })} />)}
      {total > shown.length && <Link to={postPath(post.id)} className="block py-1.5 text-[13px] text-muted">{t('查看全部 {n} 条评论', { n: total })}</Link>}
      {status === 'ready' && (
        <button type="button" onClick={() => nav(postPath(post.id), { state: { compose: true } })} className="flex min-h-10 w-full items-center gap-2.5 text-left">
          <Avatar address={me?.address || 'anon'} src={me?.avatar} name={me?.nickname} size={24} />
          <span className="text-[13px] text-muted">{t('写评论…')}</span>
        </button>
      )}
    </div>
  )
}
