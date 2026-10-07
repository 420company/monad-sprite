// Posts: the composer plus personal / token feeds; failed and post-success empty lists render separately.
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, Image as ImageIcon, Keyboard, LoaderCircle, MessageSquare, RefreshCw, Send, Smile, Trash2, WifiOff, X, Pin } from 'lucide-react'
import PostReport from '@/components/PostReport'
import { CommentPreview, confirmDeleteText, postPath } from './Comments'
import { EmptyState, LoadMore } from './ListState'
import { usePaged, nextCursorOf } from '@/lib/usePaged'
import type { Comment } from '@/lib/comments'
import EmojiPicker, { useEmojiInput } from './EmojiPicker'
import Avatar from './Avatar'
import Button from './Button'
import ChainBadge from './ChainBadge'
import { toast } from './Toast'
import { api, SOCIAL_API } from '@/lib/social'
import { chainByDexKey, marketLinkOf } from '@/lib/chains'
import { timeAgo, sideLabel } from '@/lib/format'
import { useSocial, displayName } from '@/store/social'
import { useMarket } from '@/store/market'
import { marketKey } from '@/lib/market'
import XBadge from '@/components/XBadge'
import PostBody from './PostBody'
import { compressForUpload } from '@/lib/imageCompress'
import { absUrl, thumbOf, type PostImage } from '@/lib/postImage'
import { t } from '@/lib/i18n'
import { canModerate, useStaffRole } from '@/lib/staff'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

// Confirmation copy moved to Comments.tsx (the comment menu uses it too) — re-exported here so old imports don't change
export { confirmDeleteText }

export interface Post { id: string; author: string; nickname: string | null; avatar: string | null; handle?: string | null; text: string; image: string | null; images?: PostImage[]; token: { chain: string; address: string; symbol: string | null } | null; likes: number; comments?: number; liked: boolean; createdAt: number; topComments?: Comment[] }

const MAX_IMAGES = 9

export function PostComposer({ token, onPosted, onBusyChange }: { token?: { chain: string; address: string; symbol: string }; onPosted: (p: Post) => void; onBusyChange?: (busy: boolean) => void }) {
  const { me, status } = useSocial()
  const cache = useMarket((s) => s.cache)
  const [text, setText] = useState('')
  const emoji = useEmojiInput<HTMLTextAreaElement>(text, setText, 1000)
  const [images, setImages] = useState<PostImage[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const inputId = useId()
  const disabled = busy || uploading || status !== 'ready'
  // Admins can pin global posts directly (2026-09-27 goat); token-page posts can't be pinned
  const staffRole = useStaffRole()
  const canPin = !token && (staffRole === 'admin' || staffRole === 'super')
  const [pin, setPin] = useState(false)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { onBusyChange?.(busy || uploading) }, [busy, uploading, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])
  // Multi-image selection uploads one by one: compressed on-device first (long edge 2048), then the server uniformly produces full-size + thumbnails
  const upload = async (list: FileList | null) => {
    const files = [...(list || [])].slice(0, MAX_IMAGES - images.length)
    if (!files.length || disabled || pending.current) return
    if (files.some(f => !f.type.startsWith('image/'))) return toast.error(t('请选择图片文件'))
    pending.current = true
    setUploading(true)
    try {
      for (const f of files) {
        const fd = new FormData(); fd.append('file', await compressForUpload(f))
        const r = await api<{ url: string; thumb?: string; width?: number; height?: number }>('/api/upload', { method: 'POST', body: fd })
        if (!mounted.current) return
        setImages(cur => cur.length >= MAX_IMAGES ? cur : [...cur, { url: r.url, thumb: r.thumb, w: r.width, h: r.height }])
      }
    } catch (e) { toast.error(errorText(e, t('上传失败'))) }
    finally { pending.current = false; if (mounted.current) setUploading(false) }
  }
  const submit = async () => {
    if (disabled || pending.current || (!text.trim() && !images.length)) return
    pending.current = true
    setBusy(true)
    try {
      const live = token ? cache[marketKey(token.chain, token.address)] : undefined
      const snapshot = live ? { price: live.priceUsd, change24h: live.change24h, marketCap: live.marketCap ?? live.fdv, logo: live.logo } : undefined
      const p = await api<Post>('/api/posts', { method: 'POST', body: JSON.stringify({ text, images, token, snapshot, ...(canPin && pin ? { pinned: true } : {}) }) })
      if (mounted.current) { setText(''); setImages([]); setPin(false); emoji.dismiss(); onPosted(p) }
      toast.success(t('已发布'))
    } catch (e) { toast.error(errorText(e, t('发布失败'))) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return (
    <form onSubmit={e => { e.preventDefault(); void submit() }} className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-2.5 pb-3">
        <Avatar address={me?.address || 'anon'} src={me?.avatar} name={me?.nickname} size={32} />
        <span className="min-w-0 truncate text-sm font-medium">{me ? <UserName address={me.address} name={displayName(me)} /> : t('未连接')}</span>
        {token && <span className="ml-auto min-w-0 truncate text-xs text-muted">${token.symbol}</span>}
      </div>
      <label htmlFor={inputId} className="sr-only">{t('动态内容')}</label>
      <textarea {...emoji.fieldProps} id={inputId} value={text} onChange={e => setText(e.target.value)} rows={3} disabled={busy || status !== 'ready'} placeholder={token ? t('聊聊 {symbol}', { symbol: token.symbol }) : t('分享你的看法')} className="min-h-24 w-full resize-y rounded bg-transparent text-[15px] leading-relaxed placeholder:text-muted disabled:opacity-50" maxLength={1000} />
      {images.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{images.map((img, i) => <div key={img.url + i} className="relative h-20 w-20"><img src={absUrl(thumbOf(img), SOCIAL_API)} alt={t('待发布图片')} className="h-full w-full rounded-lg bg-card object-cover" /><button type="button" onClick={() => setImages(cur => cur.filter((_, j) => j !== i))} disabled={disabled} className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-bg text-fg shadow" aria-label={t('移除图片')}><X size={16} /></button></div>)}</div>}
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2">
        <button type="button" onClick={() => file.current?.click()} disabled={disabled || images.length >= MAX_IMAGES} className="icon-button" aria-label={t('添加图片')} data-tooltip={t('添加图片')}>{uploading ? <LoaderCircle size={20} className="animate-spin" /> : <ImageIcon size={20} />}</button>
        <button type="button" onClick={emoji.toggle} disabled={busy || status !== 'ready'} className="icon-button" aria-label={emoji.open ? t('键盘') : t('表情')} aria-expanded={emoji.open} data-tooltip={emoji.open ? t('键盘') : t('表情')}>{emoji.open ? <Keyboard size={20} /> : <Smile size={20} />}</button>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={e => { void upload(e.target.files); e.target.value = '' }} />
        {canPin && <button type="button" role="switch" aria-checked={pin} onClick={() => setPin((v) => !v)} disabled={disabled} className={`flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold ${pin ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}><Pin size={14} />{t('置顶')}</button>}
        <span className="number min-w-0 flex-1 text-xs text-muted" role={uploading ? 'status' : undefined}>{uploading ? t('上传中') : images.length ? `${images.length}/${MAX_IMAGES}` : text.length > 800 ? `${text.length}/1000` : ''}</span>
        <Button type="submit" size="sm" loading={busy} disabled={disabled || (!text.trim() && !images.length)}><Send size={16} />{t('发布')}</Button>
      </div>
      {emoji.open && <EmojiPicker className="-mx-3 mt-2 border-t border-line" onPick={emoji.pick} onBackspace={emoji.backspace} />}
      {status !== 'ready' && <p className="mt-2 text-sm text-warning" role="status">{t('暂时无法连接社区，请稍后再发布')}</p>}
    </form>
  )
}

// Both post lists share status feedback, so API errors aren't mistaken for empty content.
export function PostFeedback({ state, onRetry, emptyText = t('还没有动态') }: { state: 'loading' | 'offline' | 'error' | 'empty'; onRetry?: () => void; emptyText?: string }) {
  if (state === 'loading') return <div className="space-y-4 py-5" role="status" aria-label={t('正在加载动态')}><div className="skeleton h-12 w-2/3" /><div className="skeleton h-24" /></div>
  return <EmptyState icon={state === 'empty' ? MessageSquare : WifiOff} title={state === 'empty' ? emptyText : state === 'offline' ? t('社交服务未连接') : t('暂时无法加载动态')}
    action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry}><RefreshCw size={15} />{t('重试')}</Button>} />
}

/** Profile / token page posts: 10 per page, infinite scroll; at most 2 comments peek under each post */
export const POST_PAGE = 10

export function PostList({ filter, refreshKey }: { filter?: { token?: string; author?: string }; refreshKey?: number }) {
  const nav = useNavigate()
  const { me, status, login } = useSocial()
  const staffRole = useStaffRole()
  const query = new URLSearchParams({ ...(filter?.token ? { token: filter.token } : {}), ...(filter?.author ? { author: filter.author } : {}) }).toString()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const active = useRef(new Set<string>())
  const paged = usePaged<Post>(status === 'ready' ? query : null, async (cursor, signal) => {
    const list = await api<Post[]>(`/api/posts?${query}${query ? '&' : ''}limit=${POST_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    if (!Array.isArray(list)) throw new Error(t('无效的动态响应'))
    return { items: list, next: nextCursorOf(list, POST_PAGE) }
  }, (p) => p.id, { cache: 'posts' })   // Going back preserves the already-loaded pages
  const { items: posts, setItems, reload } = paged
  // Refresh after posting: swap only when the new first page arrives; keep showing the old one on failure
  const firstKey = useRef(refreshKey)
  useEffect(() => { if (firstKey.current !== refreshKey) { firstKey.current = refreshKey; reload() } }, [refreshKey, reload])
  const patch = (id: string, change: Partial<Post>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...change } : x)))

  const act = async (p: Post, deleting = false) => {
    if (status !== 'ready' || active.current.has(p.id)) return
    if (deleting && !confirm(confirmDeleteText(p.author === me?.address, 'post'))) return
    active.current.add(p.id); setPending(new Set(active.current))
    try {
      await api(`/api/posts/${p.id}${deleting ? '' : '/like'}`, deleting ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ on: !p.liked }) })
      if (deleting) setItems((list) => list.filter((x) => x.id !== p.id))
      else patch(p.id, { liked: !p.liked, likes: Math.max(0, p.likes + (p.liked ? -1 : 1)) })
      if (deleting) toast.success(t('已删除'))
    } catch { toast.error(deleting ? t('删除失败，动态已保留') : t('点赞失败，请重试')) }
    finally { active.current.delete(p.id); setPending(new Set(active.current)) }
  }

  if (status !== 'ready') return <PostFeedback state={status === 'logging' ? 'loading' : 'offline'} onRetry={status === 'logging' ? undefined : login} />
  if (!posts) return paged.failed ? <PostFeedback state="error" onRetry={paged.retry} /> : <PostFeedback state="loading" />
  return <div>
    {paged.failed && <div className="status-notice" role="status"><WifiOff size={16} className="shrink-0" /><span className="flex-1">{t('更新失败，显示上次加载的动态')}</span><button onClick={paged.retry} className="icon-button" aria-label={t('重试动态')} data-tooltip={t('重试')}><RefreshCw size={18} /></button></div>}
    {!posts.length && <PostFeedback state="empty" />}
    <div className="divide-y divide-line">
      {posts.map(p => <article key={p.id} className="py-5">
        <div className="flex items-center gap-2.5">
          <Link to={`/u/${p.author}`} aria-label={t('{name}的主页', { name: displayName({ address: p.author, nickname: p.nickname }) })}><Avatar address={p.author} src={p.avatar} name={p.nickname} size={36} /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1"><Link to={`/u/${p.author}`} className="min-w-0 truncate text-sm font-semibold"><UserName address={p.author} name={displayName({ address: p.author, nickname: p.nickname })} /></Link><XBadge address={p.author} /></div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted"><Link to={postPath(p.id)}><time dateTime={new Date(p.createdAt).toISOString()}>{timeAgo(p.createdAt)}</time></Link>{p.token && <><Link to={marketLinkOf(p.token.chain, p.token.address)} className="max-w-full truncate text-fg">${sideLabel(p.token.symbol || "")}</Link><ChainBadge chainId={chainByDexKey(p.token.chain)?.id || 0} /></>}</div>
          </div>
          {(p.author === me?.address || canModerate(staffRole)) && <button onClick={() => void act(p, true)} disabled={pending.has(p.id)} className="icon-button" aria-label={t('删除动态')} data-tooltip={t('删除动态')}><Trash2 size={18} /></button>}
          <PostReport id={p.id} author={p.author} name={p.nickname} />
        </div>
        <PostBody post={p} />
        {/* Comments / likes: same row, same 18px icons, numbers on one baseline; hide both numbers at 0 (2026-09-25 goat: misaligned).
            The comment button opens the full thread page and focuses the input — threads no longer expand inline in the feed */}
        <div className="mt-2 flex items-center gap-4">
        <button onClick={() => nav(postPath(p.id), { state: { compose: true } })} aria-label={t('评论')} className="flex min-h-11 items-center gap-1.5 text-[13px] text-muted"><MessageSquare size={18} /><span className="number min-w-[1ch]">{p.comments || ''}</span></button>
        <button onClick={() => void act(p)} disabled={pending.has(p.id)} aria-label={p.liked ? t('取消点赞') : t('点赞')} aria-pressed={p.liked} className={`flex min-h-11 items-center gap-1.5 text-[13px] disabled:opacity-50 ${p.liked ? 'text-down' : 'text-muted'}`}><Heart size={18} fill={p.liked ? 'currentColor' : 'none'} /><span className="number min-w-[1ch]">{p.likes || ''}</span></button>
        </div>
        <CommentPreview post={p} onPatch={(c) => patch(p.id, c)} />
      </article>)}
    </div>
    <LoadMore onMore={paged.loadMore} loading={paged.loading} done={paged.done} failed={paged.moreFailed} onRetry={paged.retry} count={posts.length} />
  </div>
}
