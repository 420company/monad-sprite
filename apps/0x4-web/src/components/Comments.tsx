// 评论（2026-09-25 改版，参考 Instagram / X）：
// · 一条评论 = 头像 + 昵称 + 时间一行，正文下一行，右边小爱心 + 赞数；不再套灰色大框
// · 删除 / 举报 / 复制收进「…」菜单（也可以长按正文）。能删的人：评论作者、帖子作者、客服 / 管理员
// · 信息流、个人主页、代币页的帖子下面只露最多 2 条（赞多优先，否则最新）+「查看全部 N 条评论」+ 一个「写评论…」入口，
//   点进去才是完整对话页（PostDetail：全部评论分页 + 底部输入框）
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

/** 删帖 / 删评论前的确认文案：删自己的照旧；客服删别人的要说清会通知作者 */
export const confirmDeleteText = (own: boolean, what: 'post' | 'comment') => own
  ? (what === 'post' ? t('删除这条动态？') : t('删除这条评论？'))
  : (what === 'post' ? t('这条动态违反社区规范，确定删除？作者会收到通知。') : t('这条评论违反社区规范，确定删除？作者会收到通知。'))

/** 进入某条帖子的完整对话页；compose = 进去后直接聚焦输入框 */
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
    onChange({ ...c, likedByMe: on, likes: Math.max(0, c.likes + (on ? 1 : -1)) }) // 先改界面，失败再退回
    try { const r = await setCommentLike(postId, c.id, on); onChange({ ...c, likedByMe: r.likedByMe, likes: r.likes }) }
    catch (e) { onChange(c); toast.error(errorText(e, t('点赞失败，请重试'))) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setMenu(null)
    // 删自己的直接删（老行为）；帖主删别人的问一句；客服删别人的说明会通知作者
    if (!own && !confirm(confirmDeleteText(mineToManage, 'comment'))) return
    try { await api(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); onRemove(c.id); toast.success(t('已删除')) }
    catch (e) { toast.error(errorText(e, t('删除失败'))) }
  }
  // 举报走统一的举报弹层（选原因、可以顺手拉黑），客服后台能看到这条评论的原文
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
 * 帖子下面的评论预览：最多 2 条 +「查看全部 N 条评论」+ 轻量的「写评论…」入口。
 * onPatch 把本地改动（点赞、删除）写回列表里那条帖子。
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
