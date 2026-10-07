// Community: posts, groups (my groups / discovered groups), messages (unified conversations), friends, rankings
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LoaderCircle, Lock, Plus, RefreshCw, Search, SquarePen, Users, Wifi, WifiOff } from 'lucide-react'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import OfficialBadge from '@/components/OfficialBadge'
import Avatar from '@/components/Avatar'
import { GateEditor, draftToGate, emptyDraft, type GateDraft } from '@/components/GateSheet'
import { Input, Label, Textarea } from '@/components/Field'
import { PostComposer } from '@/components/Posts'
import Feed from '@/components/Feed'
import Leaderboard from '@/components/Leaderboard'
import ChatList from '@/components/ChatList'
import Friends from '@/components/Friends'
import BellButton from '@/components/BellButton'
import ProfileSheet from '@/components/ProfileSheet'
import SuggestFollow from '@/components/SuggestFollow'
import { toast } from '@/components/Toast'
import { EmptyState } from '@/components/ListState'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WEB_SURFACE } from '@/lib/surface'
import { needAccount } from '@/desktop/walletGate'
import { SocialLogin } from '@/desktop/ui'
import CommunityTabs, { type CommunityTab } from '@/components/CommunityTabs'
import { WalletRequired } from '@/desktop/WalletRequired'
import { useCommunityUnread } from '@/store/announcements'
import { api, type Group } from '@/lib/social'
import { t } from '@/lib/i18n'
import { isBool, isString, oneOf, usePageState } from '@/lib/pageState'
import { errorText } from '@/lib/errors'


export default function Community() {
  const nav = useNavigate()
  const { status, me, onlineCount, wsStatus, myGroups, login, loadGroups, joinGroup } = useSocial()
  // Web without a wallet (2026-09-29 goat): public posts and rankings still viewable; posting, DMs, friends, and groups pop "Connect 0x4 Wallet"
  const guest = WEB_SURFACE && !useWallet(isWalletConnected)
  // Web with wallet connected but community not logged in (terms not agreed / login failed / logging in, 2026-10-07 goat's TokenPocket screenshot):
  // It used to say "social service not connected" for the whole page, hiding public posts and rankings too. Now public content reads as normal (like a visitor), with one line at the top explaining why and offering "View and agree / Sign in again"
  const offline = WEB_SURFACE && !guest && status !== 'ready'
  const viewAsGuest = guest || offline
  // Sub-tabs, post scope, group-search terms, and expansion state are remembered in the session (lib/pageState): tapping into a post / group / profile and back keeps the view as you left it
  const [q, setQ] = usePageState('community.groupQ', '', isString)
  // Arriving from the coin detail page's "Create a group": open group creation directly, pre-filling the group name with the coin
  const createFor = (useLocation().state as { createFor?: TokenPreset } | null)?.createFor ?? null
  const [creating, setCreating] = useState(!!createFor)
  const [editing, setEditing] = useState(false)
  // clubs (groups) only exist on web (CommunityTabs.tsx); stored ones in the phone app are still treated as messages
  const [savedTab, setTab] = usePageState<CommunityTab>('community.tab', 'feed', oneOf('feed', 'groups', 'clubs', 'friends', 'rank'))
  // Arriving from the coin detail's "Create a group": pinned to the messages (groups) tab
  const tab: CommunityTab = createFor ? 'groups' : !WEB_SURFACE && savedTab === 'clubs' ? 'groups' : savedTab
  const groupish = tab === 'groups' || tab === 'clubs'
  const [scope, setScope] = usePageState<'global' | 'friends'>('community.scope', 'global', oneOf('global', 'friends'))
  // Whether the find-groups panel is open is also remembered in the session: tapping into a group from search results and back keeps the panel and the search term
  const [findOpen, setFindOpen] = usePageState('community.findGroups', false, isBool)
  const [postKey, setPostKey] = useState(0)
  const [composing, setComposing] = useState(false)
  const [postBusy, setPostBusy] = useState(false)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsFailed, setGroupsFailed] = useState(false)
  const [groupRetry, setGroupRetry] = useState(0)
  const [discovery, setDiscovery] = useState<{ query: string; groups: Group[]; more: boolean } | null>(null)
  const [moreLoading, setMoreLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(true)
  const [searchFailed, setSearchFailed] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  // At most 100 discovered groups (server cap); draw 20 first, draw the next batch on scroll-to-bottom
  const query = q.trim()
  // Unread: groups + DMs + "0x4 Official" announcements
  const unread = useCommunityUnread()

  useEffect(() => {
    if (status !== 'ready' || !groupish) return
    let alive = true
    setGroupsLoading(true); setGroupsFailed(false)
    const timeout = setTimeout(() => { if (alive) { setGroupsLoading(false); setGroupsFailed(true) } }, 15_000)
    void useSocial.getState().loadDmList()   // The DM conversation list (the server's records) refreshes along the way
    loadGroups().then(() => { if (alive) setGroupsFailed(false) }).catch(() => { if (alive) setGroupsFailed(true) }).finally(() => { clearTimeout(timeout); if (alive) setGroupsLoading(false) })
    return () => { alive = false; clearTimeout(timeout) }
  }, [status, groupish, groupRetry, loadGroups])

  // Search is independent of the session subscription — cancel old requests so slow responses don't write back onto new keywords.
  useEffect(() => {
    if (status !== 'ready' || !groupish) return
    let alive = true
    const controller = new AbortController()
    setSearchLoading(true); setSearchFailed(false)
    const timeout = setTimeout(() => controller.abort(), 15_000)
    const timer = setTimeout(() => {
      api<Group[]>(`/api/groups?q=${encodeURIComponent(query)}&limit=${GROUP_PAGE + 1}&offset=0`, { signal: controller.signal }).then(groups => {
        if (!Array.isArray(groups)) throw new Error(t('加载失败'))
        if (alive) setDiscovery({ query, groups: groups.slice(0, GROUP_PAGE), more: groups.length > GROUP_PAGE })
      }).catch(() => { if (alive) setSearchFailed(true) }).finally(() => { clearTimeout(timeout); if (alive) setSearchLoading(false) })
    }, query ? 250 : 0)
    return () => { alive = false; clearTimeout(timer); clearTimeout(timeout); controller.abort() }
  }, [status, groupish, query, groupRetry])

  // When not searching, only recommend unjoined groups; when searching (e.g. by group number), joined groups show too, with the button switched to "Enter" (2026-09-27 goat: couldn't find my own group by its number)
  // While typing, keep the previous results (dimmed); swap in the new ones when they arrive instead of flashing the whole block into a loader
  const shown = discovery && (discovery.query === query || searchLoading) ? discovery : null
  const others = (shown?.groups ?? []).filter(g => query.trim() || !myGroups.some(m => m.id === g.id))
  // Show 15 at a time, "show more" fetches 15 more (2026-09-29 goat: don't make one page too long)
  const loadMoreGroups = async () => {
    if (!discovery || moreLoading) return
    setMoreLoading(true)
    try {
      const next = await api<Group[]>(`/api/groups?q=${encodeURIComponent(discovery.query)}&limit=${GROUP_PAGE + 1}&offset=${discovery.groups.length}`)
      if (!Array.isArray(next)) throw new Error(t('加载失败'))
      setDiscovery((d) => d && d.query === discovery.query ? { ...d, groups: [...d.groups, ...next.slice(0, GROUP_PAGE).filter(g => !d.groups.some(x => x.id === g.id))], more: next.length > GROUP_PAGE } : d)
    } catch (e) { toast.error(errorText(e, t('加载失败'))) } finally { setMoreLoading(false) }
  }

  const join = async (g: Group) => {
    if (joining) return
    setJoining(g.id)
    try { await joinGroup(g.id); nav(`/g/${g.id}`) } catch (e) { const err = e as Error & { pending?: boolean }; if (err.pending) toast.success(err.message); else toast.error(errorText(err, t('加入失败'))) } finally { setJoining(null) }
  }

  return (
    <div className="safe-top">
      <header className="page-header page-gutter">
        <div>
          <h1 className="page-title">{t('社区')}</h1>
          {!guest && <div className="mt-1 flex items-center gap-1.5 text-xs text-muted" role="status">{status === 'ready' && wsStatus === 'open' ? <><Wifi size={13} className="text-up" /><span className="number">{t('{n} 人在线', { n: onlineCount })}</span></> : <><WifiOff size={13} />{status === 'logging' ? t('正在连接') : status === 'ready' ? t('实时连接恢复中') : t('未连接')}</>}</div>}
        </div>
        {!guest && <div className="account-tools">
          <BellButton />
          <button onClick={() => setEditing(true)} disabled={status !== 'ready'} className="icon-button" aria-label={t('我的资料')} data-tooltip={t('我的资料')}><Avatar address={me?.address || 'anon'} src={me?.avatar} name={me?.nickname} size={32} chainId={me?.avatarNft?.chainId} /></button>
        </div>}
      </header>

      {/* Web (narrow mobile browser) adds a "Streaming" tab: web has no separate live tab at the bottom (CommunityTabs.tsx) */}
      {WEB_SURFACE ? <CommunityTabs active={tab} onTab={setTab} unread={unread} /> : <div className="page-gutter grid grid-cols-4 gap-3 border-b border-line" role="group" aria-label={t('社区视图')}>
        {(['feed', 'groups', 'friends', 'rank'] as const).map(v => <button key={v} onClick={() => setTab(v)} aria-pressed={tab === v} className="view-tab relative">{t({ feed: '动态', groups: '消息', friends: '好友', rank: '排行' }[v])}{v === 'groups' && unread > 0 && <span aria-label={t('{n} 条未读', { n: unread })} className="absolute top-1 right-0 h-1.5 w-1.5 rounded-full bg-accent" />}</button>)}
      </div>}
      {/* Public content (feed, rankings) gets a one-line reason on top; login-gated content (friends, groups, messages) gets a full block with reason + button */}
      {offline && (tab === 'feed' || tab === 'rank') && <div className="page-gutter"><SocialLogin bar /></div>}
      {offline && tab !== 'feed' && tab !== 'rank' && <div className="page-gutter py-8"><SocialLogin row={false} /></div>}
      {!WEB_SURFACE && status !== 'ready' ? <section className="page-gutter empty-state" role="status">
        {status === 'logging' ? <LoaderCircle size={24} className="animate-spin" /> : <WifiOff size={24} strokeWidth={1.5} />}
        <h2 className="text-base font-semibold">{status === 'logging' ? t('正在连接社区') : t('社交服务未连接')}</h2>
        <p className="mt-2 text-sm text-muted">{status === 'logging' ? t('正在登录') : t('暂时无法获取动态和消息')}</p>
        {status !== 'logging' && <Button className="mt-5" size="sm" variant="secondary" onClick={login}><RefreshCw size={16} />{t('重新连接')}</Button>}
      </section> : <>
      {!viewAsGuest && wsStatus !== 'open' && <div className="page-gutter status-notice" role="status"><WifiOff size={16} className="shrink-0" /><span>{t('消息连接中断，正在重新连接')}</span></div>}
      {tab === 'feed' && (
        <section aria-label={t('社区动态')}>
          <div className="page-gutter flex items-center justify-between gap-3 py-3">
            <div className="flex gap-1" role="group" aria-label={t('动态范围')}>{(viewAsGuest ? ['global'] as const : ['global', 'friends'] as const).map(sc => <button key={sc} onClick={() => setScope(sc)} aria-pressed={(viewAsGuest ? 'global' : scope) === sc} className={`min-h-11 rounded-lg px-4 text-sm ${(viewAsGuest ? 'global' : scope) === sc ? 'bg-card2 font-semibold text-fg' : 'text-muted'}`}>{sc === 'global' ? t('全球') : t('关注||count')}</button>)}</div>
            <button onClick={() => { if (!needAccount()) setComposing(true) }} className="icon-button bg-card2 text-fg" aria-label={t('发布动态')} data-tooltip={t('发布动态')}><SquarePen size={20} /></button>
          </div>
          <Feed scope={viewAsGuest ? 'global' : scope} refreshKey={postKey} />
        </section>
      )}
      {tab === 'rank' && <Leaderboard />}
      {tab === 'friends' && !offline && (guest ? <WalletRequired compact /> : <Friends />)}
      {tab === 'clubs' && guest && <WalletRequired compact />}
      {/* Groups (web at phone width): my groups first, discovered groups after — same as the wide-screen "Groups" page (10/03 goat) */}
      {tab === 'clubs' && !viewAsGuest && <section className="page-gutter" aria-label={t('群组')}>
        <div className="section-header pt-3">
          <h2 className="section-title">{t('我的群')}</h2>
          <button onClick={() => setCreating(true)} className="icon-button" aria-label={t('创建群')} data-tooltip={t('创建群')}><Plus size={20} /></button>
        </div>
        {groupsLoading && !myGroups.length ? <div className="py-3" role="status" aria-label={t('加载中…')}><div className="skeleton h-16" /></div>
          : groupsFailed && !myGroups.length ? <div className="status-notice" role="status"><WifiOff size={16} className="shrink-0" /><span className="flex-1">{t('暂时无法加载群列表')}</span><button onClick={() => setGroupRetry(n => n + 1)} className="icon-button" aria-label={t('重试')}><RefreshCw size={18} /></button></div>
          : myGroups.length ? <div className="divide-y divide-line/60">{myGroups.map(g => <GroupRow key={g.id} g={g} action={<Button size="sm" variant="secondary" onClick={() => nav(`/g/${g.id}`)}>{t('进入')}</Button>} />)}</div>
            : <p className="py-4 text-sm text-muted">{t('当前还没有加入任何群组')}</p>}
        <div className="section-header mt-4 border-t border-line pt-4">
          <h2 className="section-title">{t('发现群')}</h2>
        </div>
        <div className="relative"><Search size={18} className="pointer-events-none absolute top-4 left-3 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} aria-label={t('搜索群名或群号')} placeholder={t('输入群号或群名')} className="ui-field pl-10" /></div>
        {searchLoading && !shown && <div className="py-4" role="status" aria-label={t('正在查找群')}><div className="skeleton h-20" /></div>}
        {searchFailed && <div className="status-notice mt-3" role="status"><WifiOff size={16} className="shrink-0" /><span className="flex-1">{t('暂时无法加载群列表')}</span><button onClick={() => setGroupRetry(n => n + 1)} className="icon-button" aria-label={t('重试发现群')}><RefreshCw size={18} /></button></div>}
        {shown && !searchFailed && <div className={`divide-y divide-line/60 transition-opacity duration-150 ${searchLoading ? 'opacity-60' : ''}`} aria-busy={searchLoading}>{others.map(g => <GroupRow key={g.id} g={g} highlight={shown.query} action={myGroups.some(m => m.id === g.id) ? <Button size="sm" variant="secondary" onClick={() => nav(`/g/${g.id}`)}>{t('进入')}</Button> : <Button size="sm" variant="secondary" disabled={!!joining} loading={joining === g.id} onClick={() => void join(g)}>{g.gate && <Lock size={13} />}{g.joinMode === 'approval' ? t('申请') : t('加入')}</Button>} />)}
          {!others.length && !searchLoading && <EmptyState icon={Users} title={query ? t('没有找到匹配的群') : t('暂时没有更多群')} />}</div>}
        {shown?.more && !searchFailed && <div className="pt-3 pb-4"><Button variant="secondary" className="w-full" loading={moreLoading} disabled={moreLoading || searchLoading} onClick={() => void loadMoreGroups()}>{t('显示更多')}</Button></div>}
      </section>}
      {tab === 'groups' && guest && <WalletRequired compact />}
      {tab === 'groups' && !viewAsGuest && <>
      {/* 2026-09-28 goat: "Find groups" moves from the bottom of the list to beside the plus button as a magnifier that opens a search panel; a "Discover communities" strip goes above conversations, randomly showing groups already created on the server */}
      <div className="page-gutter section-header pt-3">
        <h2 className="section-title">{t('会话')}</h2>
        <div className="flex items-center">
          <button onClick={() => setFindOpen(true)} className="icon-button" aria-label={t('找群')} data-tooltip={t('找群')}><Search size={20} /></button>
          <button onClick={() => setCreating(true)} className="icon-button" aria-label={t('创建群')} data-tooltip={t('创建群')}><Plus size={20} /></button>
        </div>
      </div>
      <DiscoverStrip joined={myGroups} />
      <ChatList loading={groupsLoading} failed={groupsFailed} onRetry={() => setGroupRetry(n => n + 1)} />
      <Sheet open={findOpen} onClose={() => setFindOpen(false)} title={t('找群')}>
        <div className="relative"><Search size={18} className="pointer-events-none absolute top-4 left-3 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} aria-label={t('搜索群名或群号')} placeholder={t('输入群号或群名')} className="ui-field pl-10" /></div>
        {searchLoading && !shown && <div className="py-4" role="status" aria-label={t('正在查找群')}><div className="skeleton h-20" /></div>}
        {searchFailed && <div className="status-notice mt-3" role="status"><WifiOff size={16} className="shrink-0" /><span className="flex-1">{t('暂时无法加载群列表')}</span><button onClick={() => setGroupRetry(n => n + 1)} className="icon-button" aria-label={t('重试发现群')} data-tooltip={t('重试')}><RefreshCw size={18} /></button></div>}
        {shown && !searchFailed && <div className={`divide-y divide-line/60 transition-opacity duration-150 ${searchLoading ? 'opacity-60' : ''}`} aria-busy={searchLoading}>{others.map(g => <GroupRow key={g.id} g={g} highlight={shown.query} action={myGroups.some(m => m.id === g.id) ? <Button size="sm" variant="secondary" onClick={() => nav(`/g/${g.id}`)}>{t('进入')}</Button> : <Button size="sm" variant="secondary" disabled={!!joining} loading={joining === g.id} onClick={() => void join(g)}>{g.gate && <Lock size={13} />}{g.joinMode === 'approval' ? t('申请') : t('加入')}</Button>} />)}
        {!others.length && !searchLoading && <EmptyState icon={Users} title={query ? t('没有找到匹配的群') : t('暂时没有更多群')} />}</div>}
        {shown?.more && !searchFailed && <div className="pt-3"><Button variant="secondary" className="w-full" loading={moreLoading} disabled={moreLoading || searchLoading} onClick={() => void loadMoreGroups()}>{t('显示更多')}</Button></div>}
      </Sheet>
      </>}
      </>}

      {/* Recommended follows stay on the posts tab, keeping the existing show-once rule. */}
      {tab === 'feed' && !viewAsGuest && <SuggestFollow />}
      <Sheet open={composing} onClose={() => setComposing(false)} title={t('发布动态')} dismissible={!postBusy}><PostComposer onBusyChange={setPostBusy} onPosted={() => { setPostKey(k => k + 1); setComposing(false) }} /></Sheet>
      <CreateGroupSheet open={creating} preset={createFor} onClose={() => { setCreating(false); if (createFor) { setTab('groups'); nav('/community', { replace: true, state: null }) } }} />
      <ProfileSheet open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

/** Discover communities (2026-09-28 goat): a horizontally scrolling card above the conversation list, randomly showing up to 10 groups that exist on the server and that I haven't joined, with a shuffle button to redraw.
 *  Whether a group needs review or has entry requirements is the owner's setting — this only displays; tapping a card opens the group page, which shows join / apply / token-gating per the group's rules.
 *  It sits above the conversation list as its own horizontal strip, taking no conversation slots, so it never crowds out joined groups later. */
function DiscoverStrip({ joined }: { joined: Group[] }) {
  const [all, setAll] = useState<Group[] | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let alive = true
    api<Group[]>('/api/groups?q=').then((l) => { if (alive && Array.isArray(l)) setAll(l) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const pool = useMemo(() => { const mine = new Set(joined.map((g) => g.id)); return (all || []).filter((g) => !mine.has(g.id)) }, [all, joined])
  // Reshuffle on every page entry and every "shuffle" tap; don't reshuffle on list updates (e.g. just joined a group) so cards don't jump around
  const order = useMemo(() => { const a = pool.map((g) => g.id); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }, [round, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const picks = order.map((id) => pool.find((g) => g.id === id)).filter((g): g is Group => !!g).slice(0, 10)
  if (!picks.length) return null
  return (
    <section className="mb-1" aria-label={t('发现社区')}>
      <div className="page-gutter flex items-center justify-between pb-2">
        <h3 className="text-xs font-medium tracking-wide text-muted">{t('发现社区')}</h3>
        {pool.length > 10 && <button onClick={() => setRound((n) => n + 1)} className="flex min-h-8 items-center gap-1 text-xs font-medium text-accent"><RefreshCw size={12} aria-hidden="true" />{t('换一批')}</button>}
      </div>
      <div className="flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {picks.map((g) => (
          <Link key={g.id} to={`/g/${g.id}`} className="discover-card w-[136px] shrink-0 snap-start rounded-[18px] border border-line/60 p-3 active:scale-[.98]">
            <Avatar address={g.id} src={g.avatar} name={g.name} size={40} />
            <div className="mt-2.5 flex min-w-0 items-center gap-1"><span className="truncate text-[14px] font-semibold">{g.name}</span>{g.official === true && <OfficialBadge size={14} className="shrink-0" />}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
              <Users size={11} aria-hidden="true" /><span className="number">{t('{n} 人', { n: g.memberCount })}</span>
              {g.gate ? <Lock size={10} className="ml-auto" aria-label={t('需持币')} /> : g.joinMode === 'approval' ? <span className="ml-auto">{t('需审核')}</span> : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** Highlight the parts of a group name matching the search terms (case-insensitive, per space-separated word); no highlighting when searching by group number */
function Highlight({ text, query }: { text: string; query?: string }) {
  const q = (query || '').trim()
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || /^\d{6,9}$/.test(q)) return <>{text}</>
  const esc = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'ig'))
  return <>{parts.map((p, i) => words.includes(p.toLowerCase()) ? <mark key={i} className="bg-transparent font-semibold text-accent">{p}</mark> : p)}</>
}

const GROUP_PAGE = 15

function GroupRow({ g, action, highlight }: { g: Group; action?: React.ReactNode; highlight?: string }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <Link to={`/g/${g.id}`} className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar address={g.id} src={g.avatar} name={g.name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="truncate"><Highlight text={g.name} query={highlight} /></span>
          {g.official === true && <OfficialBadge size={16} className="-ml-1" />}
          {g.role === 'owner' && <span className="rounded-full bg-accent/15 px-1.5 text-[10px] text-accent">{t('群主')}</span>}
          {g.role === 'admin' && <span className="rounded-full bg-social/15 px-1.5 text-[10px] text-muted">{t('管理员')}</span>}
          {g.gate && <span className="flex items-center gap-0.5 rounded-full bg-card2 px-1.5 text-[10px] text-muted"><Lock size={9} />{g.gate.symbol}</span>}
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted"><Users size={12} /><span className="number">{t('{n} 人', { n: g.memberCount })}</span>{g.num ? <span className="number"> · {t('群号')} {g.num}</span> : null}{g.description && <span className="truncate"> · {g.description}</span>}</div>
      </div>
      </Link>
      {action}
    </div>
  )
}

export interface TokenPreset { chain: string; address: string; symbol: string }

export function CreateGroupSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: TokenPreset | null }) {
  const nav = useNavigate()
  const createGroup = useSocial((s) => s.createGroup)
  const [name, setName] = useState(preset ? t('{symbol} 持有者', { symbol: preset.symbol }) : '')
  const [desc, setDesc] = useState('')
  const [gated, setGated] = useState(false)
  const [approval, setApproval] = useState(false)
  const [gate, setGate] = useState<GateDraft>(emptyDraft()) // Token or NFT threshold
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const g = await createGroup({
        name: name.trim(), description: desc.trim() || undefined, joinMode: approval ? 'approval' : 'open',
        gate: gated ? draftToGate(gate) : null,
      })
      toast.success(t('建群成功'))
      onClose()
      nav(`/g/${g.id}`)
    } catch (e) { toast.error(errorText(e, t('建群失败'))) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('创建群')} dismissible={!busy}>
      <div className="space-y-4">
        <div><Label htmlFor="group-name">{t('群名')}</Label><Input id="group-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder={t('群名称')} maxLength={40} /></div>
        <div><Label htmlFor="group-description">{t('简介')}</Label><Textarea id="group-description" value={desc} disabled={busy} onChange={(e) => setDesc(e.target.value)} placeholder={t('这个群聊什么')} maxLength={300} /></div>
        <label className="flex items-center justify-between gap-3 border-b border-line py-3">
          <span className="text-sm"><span className="font-semibold">{t('入群需审批')}</span><span className="block text-xs text-muted">{t('申请后由群主 / 管理员批准才能进')}</span></span>
          <input type="checkbox" checked={approval} disabled={busy} onChange={(e) => setApproval(e.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />
        </label>
        <label className="flex items-center justify-between gap-3 border-b border-line py-3">
          <span className="text-sm"><span className="font-semibold">{t('进群门槛')}</span><span className="block text-xs text-muted">{t('持有指定代币或 NFT 的钱包才能加入')}</span></span>
          <input type="checkbox" checked={gated} disabled={busy} onChange={(e) => setGated(e.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />
        </label>
        {gated && <GateEditor value={gate} onChange={setGate} />}
        <Button size="lg" className="w-full" disabled={!name.trim() || (gated && !draftToGate(gate))} loading={busy} onClick={submit}>{t('创建')}</Button>
      </div>
    </Sheet>
  )
}
