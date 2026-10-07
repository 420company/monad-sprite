// Friends: mutual follows are friends; friends can DM with end-to-end encryption. Requests = they follow you but you haven't followed back; recommended = active traders
// Friend list paged (30 per page, scroll to bottom for more); requests come with the first page; search and recommendations are already capped (20 / 8)
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
      <Link to={`/u/${u.address}`} className="relative shrink-0"><Avatar address={u.address} src={u.avatar} name={u.nickname} size={44} chainId={(u as { avatarNft?: { chainId: number } | null }).avatarNft?.chainId} />{/* Online status dot at top-right: bottom-right is the NFT avatar's chain badge — an offline gray dot squeezed next to it looks like two verification badges (2026-09-27 goat) */}{'online' in u && u.online && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-bg bg-up" aria-label={t('在线')} />}</Link>
      <Link to={`/u/${u.address}`} className="min-w-0 flex-1"><div className="flex items-center gap-1"><UserName address={u.address} name={displayName(u)} className="truncate font-semibold" /><XBadge address={u.address} size={12} /></div><div className="truncate text-xs text-muted">{u.handle ? `@${u.handle}` : shortId(u.evmAddress || u.address)}{'online' in u ? (u.online ? ` · ${t('在线')}` : u.lastSeen ? ` · ${timeAgo(u.lastSeen)}` : '') : ` · ${t('{n} 粉丝', { n: (u as Suggested).followers })}`}</div></Link>
      {action}
    </div>
  )
}

const USER_PAGE = 15
/** Search results exclude me */
const notMe = (list: Suggested[]) => list.filter((u) => u.address !== useSocial.getState().me?.address)

export default function Friends() {
  const nav = useNavigate()
  const { status } = useSocial()
  const [requests, setRequests] = useState<FriendRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [suggested, setSuggested] = useState<Suggested[]>([])
  const [q, setQ] = usePageState('friends.q', '', isString)   // The search term is kept in session — opening a profile and coming back preserves it
  const [results, setResults] = useState<Suggested[]>([])
  // Search results show 15 at a time, "show more" fetches further (2026-09-29 goat: don't make a page too long)
  const [resultMore, setResultMore] = useState(false)
  const [resultMoreLoading, setResultMoreLoading] = useState(false)
  const [searched, setSearched] = useState('')
  const resultOffset = useRef(0)

  const friends = usePaged<FriendRow>(status === 'ready' ? 'friends' : null, async (cursor, signal) => {
    const r = await api<FriendsPage>(`/api/friends?limit=${FRIEND_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    // Requests and the total come only with the first page
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

  // Max 30 per page: friends are pulled from the server in batches; requests and search results arrive in one go
  const friendPager = usePager(friends.items, { loadMore: friends.loadMore, done: friends.done, loading: friends.loading, failed: friends.moreFailed })
  const requestPager = usePager(requests)
  const moreResults = async () => {
    if (resultMoreLoading || !searched) return
    setResultMoreLoading(true)
    try {
      // Page forward by the count the server has already given (no misalignment when I get filtered out client-side)
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
