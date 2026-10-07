// 信息流：全球 / 好友。交易自动生成的「买入 / 卖出」帖、带价格快照的「观点」帖、普通帖
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, MessageSquare, Pin, PinOff, RefreshCw, Trash2, WifiOff } from 'lucide-react'
import PostReport from '@/components/PostReport'
import Avatar from './Avatar'
import TokenLogo from './TokenLogo'
import { PostFeedback } from './Posts'
import { CommentPreview, confirmDeleteText, postPath } from './Comments'
import { Pager, usePager } from './ListState'
import { usePaged, nextCursorOf } from '@/lib/usePaged'
import type { Comment } from '@/lib/comments'
import { sideLabel } from '@/lib/format'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { marketKey } from '@/lib/market'
import { isPerpMarket, marketLinkOf } from '@/lib/chains'
import { fmtAmount, fmtUsd, timeAgo } from '@/lib/format'
import { useMarket } from '@/store/market'
import { useSocial, displayName } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WEB_SURFACE } from '@/lib/surface'
import { needWallet } from '@/desktop/walletGate'
import XBadge from '@/components/XBadge'
import PostBody from './PostBody'
import type { PostImage } from '@/lib/postImage'
import { t } from '@/lib/i18n'
import { canModerate, useStaffRole } from '@/lib/staff'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

export interface FeedPost {
  /** 管理员置顶的（全球动态第一页最上面） */
  pinned?: boolean
  id: string; author: string; nickname: string | null; avatar: string | null; handle: string | null; text: string; image: string | null; images?: PostImage[]; kind: 'text' | 'trade' | 'opinion'
  token: { chain: string; address: string; symbol: string; /** 合约成交（服务器已把 ETH-PERP 换成 ETH） */ perp?: boolean } | null
  /** 小精灵自己发的成交动态：作者是小精灵（2026-10-05 goat：原来显示成小精灵的地址） */
  sprite?: { id: string; name: string; owner: string; ownerNickname: string | null } | null
  snapshot: { side?: 'buy' | 'sell'; qty?: number; usd?: number; price?: number | null; marketCap?: number | null; realized?: number; change24h?: number | null; logo?: string | null } | null
  likes: number; comments?: number; liked: boolean; createdAt: number
  /** 现货买入的交易帖：作者现在还持有（服务器查持仓，2026-10-01）；其它帖子 null */
  holding?: boolean | null
  /** 帖子下面露的评论（服务端按「赞多优先，否则最新」挑好，最多 2 条） */
  topComments?: Comment[]
}

/** 信息流每页条数，滚到底再拉下一页 */
export const FEED_PAGE = 20

export const handleOf = (p: { handle?: string | null; address: string; nickname?: string | null }) => (p.handle ? `@${p.handle}` : displayName(p))

export default function Feed({ scope, refreshKey }: { scope: 'global' | 'friends'; refreshKey?: number }) {
  const nav = useNavigate()
  const { status, login, me } = useSocial()
  // 网页版没连钱包：公开的全球动态照样能看（接口支持不登录）；点赞等互动点了弹「连接 0x4 Wallet」。
  // 2026-09-29：连了钱包但社区还没连上（登录中 / 连不上）也先按游客读公开动态，社区的状态只在页面顶部说一次（电脑端社区页中栏的状态条）
  const hasWallet = useWallet(isWalletConnected)
  const guest = WEB_SURFACE && (!hasWallet || status !== 'ready')
  const canRead = status === 'ready' || (guest && scope === 'global')
  const staffRole = useStaffRole()
  const { cache, loadTokens } = useMarket()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const active = useRef(new Set<string>())
  // 切换全球 / 关注 = 换一份数据；旧请求迟到的响应由 usePaged 丢弃
  // 游客读和登录后读分两份（登录后要带「我点过赞」），社区连上后自动换成登录那份
  const paged = usePaged<FeedPost>(canRead ? (status === 'ready' ? scope : `${scope}|guest`) : null, async (cursor, signal) => {
    const list = await api<FeedPost[]>(`/api/feed?scope=${scope}&limit=${FEED_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    if (!Array.isArray(list)) throw new Error(t('加载失败'))
    // 拉一下这一页帖子里提到的代币的现价，观点帖能显示发帖后的涨跌；永续不是链上代币，拿它的「链」去查行情只会白跑一趟
    const byChain = new Map<string, string[]>()
    list.forEach((p) => { if (p.token && !isPerpMarket(p.token.chain)) byChain.set(p.token.chain, [...(byChain.get(p.token.chain) || []), p.token.address]) })
    byChain.forEach((addrs, chain) => loadTokens([...new Set(addrs)], chain))
    return { items: list, next: nextCursorOf(list, FEED_PAGE) }
  }, (p) => p.id, { cache: 'feed' })   // 后退回来保留已加载的几页
  const { items: posts, setItems, reload, retry } = paged
  // 每页最多 30 条，点翻页（服务器分批给，本页不满自动补拉）
  const pager = usePager(posts, { reset: scope, loadMore: paged.loadMore, done: paged.done, loading: paged.loading, failed: paged.moreFailed })
  const firstKey = useRef(refreshKey)
  useEffect(() => { if (firstKey.current !== refreshKey) { firstKey.current = refreshKey; reload() } }, [refreshKey, reload])
  const patch = (id: string, change: Partial<FeedPost>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...change } : x)))

  const like = async (p: FeedPost) => {
    if (needWallet() || status !== 'ready' || active.current.has(p.id)) return
    active.current.add(p.id); setPending(new Set(active.current))
    const on = !p.liked
    try {
      await api(`/api/posts/${p.id}/like`, { method: 'POST', body: JSON.stringify({ on }) })
      patch(p.id, { liked: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) })
    } catch { toast.error(t('点赞失败，请重试')) }
    finally { active.current.delete(p.id); setPending(new Set(active.current)) }
  }

  // 删帖：作者删自己的；客服 / 管理员删违规的（服务端写审计并通知作者）
  // 管理员置顶 / 取消置顶：成功后重新拉第一页（置顶的会排到最上面）
  const togglePin = async (p: FeedPost) => {
    try { await api(`/api/posts/${p.id}/pin`, { method: 'POST', body: JSON.stringify({ pinned: !p.pinned }) }); toast.success(p.pinned ? t('已取消置顶') : t('已置顶')); reload() }
    catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  const remove = async (p: FeedPost) => {
    if (status !== 'ready' || active.current.has(p.id) || !confirm(confirmDeleteText(p.author === me?.address, 'post'))) return
    active.current.add(p.id); setPending(new Set(active.current))
    try {
      await api(`/api/posts/${p.id}`, { method: 'DELETE' })
      setItems((list) => list.filter((x) => x.id !== p.id))
      toast.success(t('已删除'))
    } catch (e) { toast.error(errorText(e, t('删除失败，动态已保留'))) }
    finally { active.current.delete(p.id); setPending(new Set(active.current)) }
  }

  if (!canRead) return <div className="page-gutter"><PostFeedback state={status === 'logging' ? 'loading' : 'offline'} onRetry={status === 'logging' ? undefined : login} /></div>
  if (!posts) return <div className="page-gutter">{paged.failed ? <PostFeedback state="error" onRetry={retry} /> : <PostFeedback state="loading" />}</div>
  return (
    <div className="page-gutter">
      {paged.failed && <div className="status-notice" role="status"><WifiOff size={16} className="shrink-0" /><span className="flex-1">{t('更新失败，显示上次加载的动态')}</span><button className="icon-button" onClick={retry} aria-label={t('重试动态')} data-tooltip={t('重试')}><RefreshCw size={18} /></button></div>}
      <div ref={pager.anchor} className="scroll-mt-20" />
      <div className="divide-y divide-line">
      {!posts.length && <PostFeedback state="empty" emptyText={scope === 'friends' ? t('关注的人还没有动态') : t('还没有动态')} />}
      {pager.pageItems.map((p) => {
        const live = p.token ? cache[marketKey(p.token.chain, p.token.address)] : undefined
        const s = p.snapshot
        return (
          <article key={p.id} className="py-5">
            <div className="flex items-center gap-2.5">
              <Link to={p.sprite ? `/fly/${p.sprite.id}` : `/u/${p.author}`} aria-label={t('{name}的主页', { name: p.sprite ? p.sprite.name : displayName({ address: p.author, nickname: p.nickname }) })}><Avatar address={p.author} src={p.avatar} name={p.sprite?.name ?? p.nickname} size={36} /></Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  {p.sprite
                    ? <Link to={`/fly/${p.sprite.id}`} className="min-w-0 truncate font-semibold">{p.sprite.name}</Link>
                    : <Link to={`/u/${p.author}`} className="min-w-0 truncate font-semibold"><UserName address={p.author} name={displayName({ address: p.author, nickname: p.nickname })} /></Link>}
                  {!p.sprite && <XBadge address={p.author} />}
                  {p.kind === 'trade' && s?.side && <span className={`shrink-0 text-xs ${s.side === 'buy' ? 'text-up' : 'text-down'}`}>{s.side === 'buy' ? t('买入') : t('卖出')}</span>}
                  {p.kind === 'opinion' && <span className="shrink-0 text-xs text-muted">{t('观点')}</span>}
                  {p.pinned && <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent"><Pin size={11} aria-hidden="true" />{t('置顶||badge')}</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{p.sprite && <span><Link to={`/u/${p.sprite.owner}`}>{t('{name} 的小精灵', { name: displayName({ address: p.sprite.owner, nickname: p.sprite.ownerNickname }) })}</Link> · </span>}{p.handle && <span>@{p.handle} · </span>}<Link to={postPath(p.id)}><time dateTime={new Date(p.createdAt).toISOString()}>{timeAgo(p.createdAt)}</time></Link></div>
              </div>
              {(staffRole === 'admin' || staffRole === 'super') && <button onClick={() => void togglePin(p)} disabled={pending.has(p.id)} className={`icon-button ${p.pinned ? 'text-accent' : ''}`} aria-label={p.pinned ? t('取消置顶') : t('置顶')} data-tooltip={p.pinned ? t('取消置顶') : t('置顶')}>{p.pinned ? <PinOff size={18} /> : <Pin size={18} />}</button>}
              {(p.author === me?.address || canModerate(staffRole)) && <button onClick={() => void remove(p)} disabled={pending.has(p.id)} className="icon-button" aria-label={t('删除动态')} data-tooltip={t('删除动态')}><Trash2 size={18} /></button>}
              <PostReport id={p.id} author={p.author} name={p.nickname} />
            </div>

            {/* 交易帖（2026-09-27 goat：数量和均价放进框里）：第一行 币种·方向 + 金额，第二行 数量 · 均价 · 市值，右边已实现盈亏 */}
            {p.kind === 'trade' && p.token && s && (
              <Link to={marketLinkOf(p.token.chain, p.token.address)} className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-card px-3 py-3">
                <TokenLogo src={live?.logo || s.logo || undefined} symbol={p.token.symbol} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2"><span className="truncate font-semibold">{sideLabel(p.token.symbol)}</span>{p.token.perp && <span className="shrink-0 rounded bg-card2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{t('合约')}</span>}<span className="number shrink-0 text-sm">{fmtUsd(s.usd, { compact: true })}</span></div>
                  <div className="number mt-0.5 truncate text-xs text-muted">{[
                    s.qty ? `${fmtAmount(s.qty)} ${p.token.symbol}` : null,
                    s.price ? t('均价 {price}', { price: fmtUsd(s.price) }) : null,
                    s.marketCap ? t('以 {cap} 市值', { cap: fmtUsd(s.marketCap, { compact: true }) }) : null,
                  ].filter(Boolean).join(' · ')}</div>
                </div>
                {s.side === 'sell' && typeof s.realized === 'number' && s.realized !== 0 && <span className={`number shrink-0 text-sm font-semibold ${s.realized > 0 ? 'text-up' : 'text-down'}`}>{s.realized > 0 ? '+' : ''}{fmtUsd(s.realized)}</span>}
                {/* 买入（2026-10-01 社区合并）：右边是买入后的涨跌（现价 / 成交均价，行情拿到才显示），下面「持有中」= 作者现在还拿着（服务器查持仓） */}
                {s.side === 'buy' && (live?.priceUsd && s.price || p.holding) ? <span className="flex shrink-0 flex-col items-end gap-0.5">
                  {live?.priceUsd && s.price ? <span className={`number text-sm font-semibold ${live.priceUsd >= s.price ? 'text-up' : 'text-down'}`}>{live.priceUsd >= s.price ? '+' : '-'}{Math.abs((live.priceUsd / s.price - 1) * 100).toFixed(1)}%</span> : null}
                  {p.holding && <span className="text-[11px] text-muted">{t('持有中')}</span>}
                </span> : null}
              </Link>
            )}

            {/* 观点帖：代币 + 现价 + 发帖以来涨跌 */}
            {p.kind === 'opinion' && p.token && (
              <Link to={marketLinkOf(p.token.chain, p.token.address)} className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-line bg-card px-3 py-3">
                <TokenLogo src={live?.logo || s?.logo || undefined} symbol={p.token.symbol} size={28} />
                <span className="min-w-0 max-w-full break-all font-semibold">{sideLabel(p.token.symbol)}</span>
                <span className="number text-sm">{fmtUsd(live?.priceUsd ?? s?.price ?? undefined)}{!live && s?.price != null && <span className="ml-1 text-xs text-muted">{t('发布时')}</span>}</span>
                {live && s?.price ? <span className={`number text-xs ${live.priceUsd >= s.price ? 'text-up' : 'text-down'}`}>{t('发帖后 {change}', { change: `${live.priceUsd >= s.price ? '+' : '-'}${Math.abs((live.priceUsd / s.price - 1) * 100).toFixed(2)}%` })}</span> : null}
              </Link>
            )}

            <PostBody post={p} />
            {/* 开单帖、观点帖、普通帖同在 posts 表，评论接口通用；之前这里只放了点赞按钮 */}
            <div className="mt-2 flex items-center gap-4">
              <button onClick={() => nav(postPath(p.id), { state: { compose: true } })} aria-label={t('评论')} className="flex min-h-11 items-center gap-1.5 text-[13px] text-muted"><MessageSquare size={18} /><span className="number min-w-[1ch]">{p.comments || ''}</span></button>
              <button onClick={() => void like(p)} disabled={pending.has(p.id)} aria-label={p.liked ? t('取消点赞') : t('点赞')} aria-pressed={p.liked} className={`flex min-h-11 items-center gap-1.5 text-[13px] disabled:opacity-50 ${p.liked ? 'text-down' : 'text-muted'}`}><Heart size={18} fill={p.liked ? 'currentColor' : 'none'} /><span className="number min-w-[1ch]">{p.likes || ''}</span></button>
            </div>
            {/* 只露最多 2 条评论 +「查看全部」+「写评论…」入口，整串评论和输入框在对话页里 */}
            <CommentPreview post={p} onPatch={(c) => patch(p.id, c)} />
          </article>
        )
      })}
      </div>
      <Pager p={pager} failed={paged.moreFailed} onRetry={retry} />
    </div>
  )
}

