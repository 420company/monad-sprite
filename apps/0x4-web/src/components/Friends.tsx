// 好友：互相关注即好友，好友之间可以端到端加密私聊。申请 = 对方关注了你还没回关；推荐 = 活跃交易者
// 好友列表分页（每页 30，滚到底加载更多），申请跟着第一页一起来；搜索和推荐本来就有上限（20 / 8）
import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageSquareLock, Search, UserPlus, Users } from 'lucide-react'
import Avatar from './Avatar'
import Button from './Button'
import { toast } from './Toast'
import { EmptyState, Pager, usePager } from './ListState'
import { api } from '@/lib/social'
import { shortId, timeAgo } from '@/lib/format'
import { usePaged } from '@/lib/usePaged'
import { useSocial, displayName } from '@/store/social'
import XBadge from '@/components/XBadge'
import { t } from '@/lib/i18n'
import { isString, usePageState } from '@/lib/pageState'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

export interface FriendRow { address: string; nickname: string | null; avatar: string | null; handle: string | null; evmAddress?: string | null; lastSeen: number | null; online: boolean }
interface Suggested { address: string; nickname: string | null; avatar: string | null; handle: string | null; evmAddress?: string | null; followers: number; posts: number }
interface FriendsPage { friends: FriendRow[]; requests: FriendRow[]; total?: number; nextCursor?: string | null }

const FRIEND_PAGE = 30
const sectionTitle = 'page-gutter pb-1 text-xs font-semibold uppercase tracking-wide text-muted'

function Row({ u, action }: { u: FriendRow | Suggested; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Link to={`/u/${u.address}`} className="relative shrink-0"><Avatar address={u.address} src={u.avatar} name={u.nickname} size={44} chainId={(u as { avatarNft?: { chainId: number } | null }).avatarNft?.chainId} />{/* 在线才显示绿点，放右上角：右下角是 NFT 头像的链标，离线灰点和它挤一起像两个认证标（2026-09-27 goat） */}{'online' in u && u.online && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-bg bg-up" aria-label={t('在线')} />}</Link>
      <Link to={`/u/${u.address}`} className="min-w-0 flex-1"><div className="flex items-center gap-1"><UserName address={u.address} name={displayName(u)} className="truncate font-semibold" /><XBadge address={u.address} size={12} /></div><div className="truncate text-xs text-muted">{u.handle ? `@${u.handle}` : shortId(u.evmAddress || u.address)}{'online' in u ? (u.online ? ` · ${t('在线')}` : u.lastSeen ? ` · ${timeAgo(u.lastSeen)}` : '') : ` · ${t('{n} 粉丝', { n: (u as Suggested).followers })}`}</div></Link>
      {action}
    </div>
  )
}

const USER_PAGE = 15
/** 搜索结果不列自己 */
const notMe = (list: Suggested[]) => list.filter((u) => u.address !== useSocial.getState().me?.address)

export default function Friends() {
  const nav = useNavigate()
  const { status } = useSocial()
  const [requests, setRequests] = useState<FriendRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [suggested, setSuggested] = useState<Suggested[]>([])
  const [q, setQ] = usePageState('friends.q', '', isString)   // 搜索词记在会话里，点进主页再返回还在
  const [results, setResults] = useState<Suggested[]>([])
  // 搜索结果一次显示 15 个，「显示更多」再往下拿（2026-09-29 goat：一页不要太长）
  const [resultMore, setResultMore] = useState(false)
  const [resultMoreLoading, setResultMoreLoading] = useState(false)
  const [searched, setSearched] = useState('')
  const resultOffset = useRef(0)

  const friends = usePaged<FriendRow>(status === 'ready' ? 'friends' : null, async (cursor, signal) => {
    const r = await api<FriendsPage>(`/api/friends?limit=${FRIEND_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    // 申请和总数只在第一页带
    if (!cursor) { setRequests(r.requests || []); setTotal(r.total ?? r.friends.length) }
    return { items: r.friends, next: r.nextCursor ?? null }
  }, (x) => x.address)
  const loadSuggested = () => { if (status === 'ready') api<Suggested[]>('/api/users/suggested').then(setSuggested).catch(() => {}) }
  useEffect(loadSuggested, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = q.trim()
    if (!key) { setResults([]); setResultMore(false); setSearched(''); return }
    let alive = true
    const timer = setTimeout(() => api<Suggested[]>(`/api/users/search?q=${encodeURIComponent(key)}&limit=${USER_PAGE + 1}&offset=0`)
      .then((r) => { if (!alive) return; resultOffset.current = Math.min(r.length, USER_PAGE); setResults(notMe(r.slice(0, USER_PAGE))); setResultMore(r.length > USER_PAGE); setSearched(key) })
      .catch(() => { if (alive) { setResults([]); setResultMore(false); setSearched(key) } }), 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [q])

  // 每页最多 30 条：好友按服务器分批拉，申请和搜索结果是一次拿全的
  const friendPager = usePager(friends.items, { loadMore: friends.loadMore, done: friends.done, loading: friends.loading, failed: friends.moreFailed })
  const requestPager = usePager(requests)
  const moreResults = async () => {
    if (resultMoreLoading || !searched) return
    setResultMoreLoading(true)
    try {
      // 按服务器已给出的条数往后翻（本人在客户端被滤掉时也不会错位）
      const r = await api<Suggested[]>(`/api/users/search?q=${encodeURIComponent(searched)}&limit=${USER_PAGE + 1}&offset=${resultOffset.current}`)
      resultOffset.current += Math.min(r.length, USER_PAGE)
      setResults((old) => [...old, ...notMe(r.slice(0, USER_PAGE)).filter((u) => !old.some((x) => x.address === u.address))])
      setResultMore(r.length > USER_PAGE)
    } catch (e) { toast.error(errorText(e, t('加载失败'))) } finally { setResultMoreLoading(false) }
  }
  const follow = async (address: string, back = false) => {
    try { await api(`/api/users/${address}/follow`, { method: 'POST' }); toast.success(back ? t('已回关，你们成为好友') : t('已关注，对方回关后成为好友')); friends.reload(); loadSuggested() } catch (e) { toast.error(errorText(e, t('失败'))) }
  }

  return (
    <div className="pb-4">
      <div className="page-gutter relative mt-3">
        <Search size={16} className="pointer-events-none absolute left-8 top-3 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜用户名或昵称')} aria-label={t('搜用户名或昵称')} className="h-10 w-full rounded-2xl bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted" />
      </div>
      {results.length > 0 && <section className="mt-4"><h2 className={sectionTitle}>{t('搜索结果')}</h2><div className="page-gutter divide-y divide-line/60">{results.map((u) => <Row key={u.address} u={u} action={<Button size="sm" variant="secondary" onClick={() => follow(u.address)}><UserPlus size={14} /> {t('关注')}</Button>} />)}</div>{resultMore && <div className="page-gutter pt-2"><Button variant="secondary" className="w-full" loading={resultMoreLoading} disabled={resultMoreLoading} onClick={() => void moreResults()}>{t('显示更多')}</Button></div>}</section>}
      {!!searched && searched === q.trim() && !results.length && <p className="page-gutter mt-4 text-sm text-muted">{t('没有找到这个用户')}</p>}

      {requests.length > 0 && (
        <section className="mt-4">
          <h2 className={sectionTitle}>{t('好友申请 · {n}', { n: requests.length })}</h2>
          <div ref={requestPager.anchor} className="page-gutter divide-y divide-line/60">{requestPager.pageItems.map((u) => <Row key={u.address} u={u} action={<Button size="sm" onClick={() => follow(u.address, true)}>{t('回关成为好友')}</Button>} />)}</div>
          <Pager p={requestPager} className="page-gutter" />
        </section>
      )}

      <section className="mt-4">
        <h2 className={sectionTitle}>{t('我的好友 · {n}', { n: total ?? friends.items?.length ?? 0 })}</h2>
        {!friends.items && (friends.failed
          ? <EmptyState icon={Users} title={t('暂时无法加载好友')} action={<Button size="sm" variant="secondary" onClick={friends.retry}>{t('重试')}</Button>} />
          : <div className="page-gutter space-y-3 py-3" role="status" aria-label={t('加载中…')}><div className="skeleton h-12" /><div className="skeleton h-12" /></div>)}
        {friends.items && !friends.items.length && <EmptyState icon={Users} title={t('还没有好友')} />}
        {friends.items && <div ref={friendPager.anchor} className="page-gutter divide-y divide-line/60">{friendPager.pageItems.map((u) => <Row key={u.address} u={u} action={<button onClick={() => nav(`/dm/${u.address}`)} className="flex min-h-9 items-center gap-1 rounded-xl bg-accent px-3 text-xs font-semibold text-bg"><MessageSquareLock size={14} /> {t('私聊')}</button>} />)}</div>}
        {friends.items && <Pager p={friendPager} failed={friends.moreFailed} onRetry={friends.retry} className="page-gutter" />}
      </section>

      {suggested.length > 0 && (
        <section className="mt-4">
          <h2 className={sectionTitle}>{t('可能想认识')}</h2>
          <div className="page-gutter divide-y divide-line/60">{suggested.slice(0, 6).map((u) => <Row key={u.address} u={u} action={<Button size="sm" variant="secondary" onClick={() => follow(u.address)}><UserPlus size={14} /> {t('关注')}</Button>} />)}</div>
        </section>
      )}
    </div>
  )
}
