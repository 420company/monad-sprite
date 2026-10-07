// 动态详情 = 这条帖子的完整对话页（2026-09-25 改版）：
// 上面是帖子原文（全文、全部大图），下面是全部评论（时间正序，每页 20 条，滚到底加载更多），
// 最底下固定输入框带表情按钮。整屏布局（Layout 里 /post/ 走 chatMode，隐藏 Tab 栏），键盘弹起时输入栏贴在键盘上方。
// 信息流里点「查看全部 N 条评论」/ 正文 / 时间进来；点评论按钮或「写评论…」进来会直接聚焦输入框。
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Heart, Keyboard, LoaderCircle, MessageSquare, Send, Smile, Trash2 } from 'lucide-react'
import PostReport from '@/components/PostReport'
import Avatar from '@/components/Avatar'
import XBadge from '@/components/XBadge'
import PostImages from '@/components/PostImages'
import EmojiPicker, { useEmojiInput } from '@/components/EmojiPicker'
import { PostFeedback } from '@/components/Posts'
import { CommentRow, confirmDeleteText } from '@/components/Comments'
import { EmptyState, LoadMore } from '@/components/ListState'
import type { FeedPost } from '@/components/Feed'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { marketLinkOf } from '@/lib/chains'
import { sideLabel, timeAgo } from '@/lib/format'
import { postImages } from '@/lib/postImage'
import { COMMENT_PAGE, normComment, type Comment } from '@/lib/comments'
import { usePaged } from '@/lib/usePaged'
import { useBack } from '@/lib/useBack'
import { useSocial, displayName } from '@/store/social'
import { t } from '@/lib/i18n'
import { canModerate, useStaffRole } from '@/lib/staff'
import UserName from '@/components/UserName'
import { errorText } from '@/lib/errors'
import { needAccount } from '@/desktop/walletGate'
import { WEB_SURFACE } from '@/lib/surface'

type CommentPage = { items: Comment[]; nextCursor: string | null; total: number }

export default function PostDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const { me, status } = useSocial()
  const staffRole = useStaffRole()
  const [post, setPost] = useState<FeedPost | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'missing' | 'ok'>('loading')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [text, setText] = useState('')
  const emoji = useEmojiInput<HTMLTextAreaElement>(text, setText, 500)
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  // 从推送直接打开时没有上一页，返回去社区
  const back = useBack('/community')
  const wantsCompose = !!(location.state as { compose?: boolean } | null)?.compose

  useEffect(() => {
    let alive = true
    setState('loading')
    api<FeedPost>(`/api/posts/${encodeURIComponent(id)}`)
      .then((p) => { if (alive) { setPost(p); setState('ok') } })
      .catch((e) => { if (alive) setState((e as { status?: number }).status === 404 ? 'missing' : 'error') })
    return () => { alive = false }
  }, [id, retry, status])

  // 评论分页：登录与否影响「我赞过没有」，所以登录状态也算进 key
  const comments = usePaged<Comment>(state === 'ok' ? `${id}|${status === 'ready' ? 'in' : 'out'}` : null, async (cursor, signal) => {
    const r = await api<CommentPage | Comment[]>(`/api/posts/${encodeURIComponent(id)}/comments?limit=${COMMENT_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    // 老服务端不认分页参数，直接回全部（数组）
    if (Array.isArray(r)) { setTotal(r.length); return { items: r.map(normComment), next: null } }
    setTotal(r.total)
    return { items: r.items.map(normComment), next: r.nextCursor }
  }, (c) => c.id, { cache: 'comments' })   // 后退回来保留已加载的评论页
  const count = total ?? post?.comments ?? 0

  // 从评论按钮 /「写评论…」进来：帖子加载好就把光标放进输入框（只做一次，返回再进来不重复弹键盘）
  const composed = useRef(false)
  useEffect(() => {
    if (!wantsCompose || composed.current || state !== 'ok' || status !== 'ready') return
    composed.current = true
    const el = emoji.fieldProps.ref.current
    el?.focus({ preventScroll: true })
    nav(location.pathname, { replace: true, state: null })
  }, [wantsCompose, state, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const like = async () => {
    if (!post || busy) return
    if (status !== 'ready') { needAccount(); return }
    setBusy(true)
    const on = !post.liked
    try {
      await api(`/api/posts/${post.id}/like`, { method: 'POST', body: JSON.stringify({ on }) })
      setPost((p) => p && { ...p, liked: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) })
    } catch { toast.error(t('点赞失败，请重试')) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!post || busy || !confirm(confirmDeleteText(post.author === me?.address, 'post'))) return
    setBusy(true)
    try { await api(`/api/posts/${post.id}`, { method: 'DELETE' }); toast.success(t('已删除')); back() }
    catch { toast.error(t('删除失败，动态已保留')); setBusy(false) }
  }
  const send = async () => {
    const body = text.trim()
    if (!body || sending || !post) return
    setSending(true)
    try {
      const c = await api<Comment>(`/api/posts/${post.id}/comments`, { method: 'POST', body: JSON.stringify({ text: body }) })
      const mine = normComment({ ...c, nickname: me?.nickname ?? null, avatar: me?.avatar ?? null, handle: (me as { handle?: string | null } | null)?.handle ?? null })
      // 新评论接在列表最后（时间正序）；还没翻到底时下一页如果又带回这条，usePaged 按 id 去重
      comments.setItems((list) => [...list, mine])
      setTotal((n) => (n ?? post.comments ?? 0) + 1)
      setText(''); emoji.dismiss()
      requestAnimationFrame(() => scroller.current?.querySelector(`[data-comment="${CSS.escape(mine.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    } catch (e) { toast.error(errorText(e, t('评论失败'))) } finally { setSending(false) }
  }

  return (
    <div className="safe-top flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button onClick={back} className="rounded-full p-2 text-muted" aria-label={t('返回')}><ArrowLeft size={22} /></button>
        <h1 className="text-lg font-bold">{t('动态')}</h1>
      </header>
      {/* data-scroll-key：从这里点进个人主页再返回，评论区停在原来的位置（components/ScrollRestorer） */}
      <div ref={scroller} data-scroll-key="post" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {state === 'loading' && <PostFeedback state="loading" />}
        {state === 'error' && <PostFeedback state="error" onRetry={() => setRetry((n) => n + 1)} />}
        {state === 'missing' && <PostFeedback state="empty" emptyText={t('这条动态不存在或已删除')} />}
        {state === 'ok' && post && <>
          <article className="pt-4">
            <div className="flex items-center gap-2.5">
              <Link to={`/u/${post.author}`}><Avatar address={post.author} src={post.avatar} name={post.nickname} size={40} /></Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-sm"><Link to={`/u/${post.author}`} className="min-w-0 truncate font-semibold"><UserName address={post.author} name={displayName({ address: post.author, nickname: post.nickname })} /></Link><XBadge address={post.author} /></div>
                <div className="mt-0.5 truncate text-xs text-muted">{post.handle && <span>@{post.handle} · </span>}<time dateTime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt)}</time></div>
              </div>
              {(post.author === me?.address || canModerate(staffRole)) && <button onClick={() => void remove()} disabled={busy} className="icon-button" aria-label={t('删除动态')}><Trash2 size={18} /></button>}
              <PostReport id={post.id} author={post.author} name={post.nickname} />
            </div>
            {post.token && <Link to={marketLinkOf(post.token.chain, post.token.address)} className="mt-3 inline-block rounded-full border border-line px-3 py-1 text-sm font-semibold">${sideLabel(post.token.symbol || '')}</Link>}
            {post.text && <p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed">{post.text}</p>}
            <PostImages images={postImages(post)} mode="full" />
            <div className="mt-2 flex items-center gap-4 border-b border-line pb-1">
              <button onClick={() => emoji.fieldProps.ref.current?.focus()} aria-label={t('评论')} className="flex min-h-11 items-center gap-1.5 text-[13px] text-muted"><MessageSquare size={18} /><span className="number min-w-[1ch]">{count || ''}</span></button>
              <button onClick={() => void like()} disabled={busy} aria-label={post.liked ? t('取消点赞') : t('点赞')} aria-pressed={post.liked} className={`flex min-h-11 items-center gap-1.5 text-[13px] disabled:opacity-50 ${post.liked ? 'text-down' : 'text-muted'}`}><Heart size={18} fill={post.liked ? 'currentColor' : 'none'} /><span className="number min-w-[1ch]">{post.likes || ''}</span></button>
            </div>
          </article>
          <section aria-label={t('评论')}>
            <h2 className="pb-1 pt-4 text-sm font-semibold">{count ? t('评论 · {n}', { n: count }) : t('评论')}</h2>
            {!comments.items && (comments.failed
              ? <PostFeedback state="error" onRetry={comments.retry} />
              : <div className="space-y-3 py-3" role="status" aria-label={t('加载评论…')}><div className="skeleton h-10" /><div className="skeleton h-10" /></div>)}
            {comments.items && !comments.items.length && <EmptyState icon={MessageSquare} title={t('还没有评论，说两句？')} />}
            {comments.items?.map((c) => <CommentRow key={c.id} c={c} postId={post.id} postAuthor={post.author}
              onChange={(n) => comments.setItems((list) => list.map((x) => (x.id === n.id ? n : x)))}
              onRemove={(cid) => { comments.setItems((list) => list.filter((x) => x.id !== cid)); setTotal((n) => Math.max(0, (n ?? count) - 1)) }} />)}
            {comments.items && <LoadMore onMore={comments.loadMore} loading={comments.loading} done={comments.done} failed={comments.moreFailed} onRetry={comments.retry} count={comments.items.length} />}
          </section>
        </>}
      </div>
      {state === 'ok' && post && (
        <div className="safe-bottom bar-glass border-t border-line px-3 pb-2 pt-2">
          {status === 'ready' ? <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <textarea {...emoji.fieldProps} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
              rows={1} maxLength={500} placeholder={t('写评论…')} aria-label={t('评论内容')}
              className="max-h-28 min-h-[42px] min-w-0 flex-1 resize-none rounded-2xl bg-card px-4 py-2.5 text-[15px] outline-none placeholder:text-muted" />
            <button type="button" onClick={emoji.toggle} className="rounded-full bg-card p-2.5 text-muted" aria-label={emoji.open ? t('键盘') : t('表情')} aria-expanded={emoji.open}>{emoji.open ? <Keyboard size={20} /> : <Smile size={20} />}</button>
            <button type="submit" disabled={!text.trim() || sending} className="rounded-full bg-accent p-2.5 text-bg disabled:opacity-40" aria-label={t('发送评论')}>{sending ? <LoaderCircle size={20} className="animate-spin" /> : <Send size={20} />}</button>
          </form> : WEB_SURFACE ? <button type="button" onClick={() => { needAccount() }} className="w-full py-2 text-center text-sm font-medium text-accent">{t('登录后评论')}</button> : <p className="py-2 text-center text-xs text-muted">{t('连接社交服务后可以评论')}</p>}
          {status === 'ready' && emoji.open && <EmojiPicker className="-mx-3 mt-2" onPick={emoji.pick} onBackspace={emoji.backspace} />}
        </div>
      )}
    </div>
  )
}
