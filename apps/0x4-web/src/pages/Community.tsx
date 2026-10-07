// 社区：动态、群组（我的群 / 发现群）、消息（统一会话）、好友、排行
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
  // 网页版没连钱包（2026-09-29 goat）：公开动态和排行照样能看；发动态、私信、好友、群点了弹「连接 0x4 Wallet」
  const guest = WEB_SURFACE && !useWallet(isWalletConnected)
  // 网页版钱包连着、社区还没登录上（没同意条款 / 登录失败 / 正在登录，2026-10-07 goat TokenPocket 截图）：
  // 以前整页写「社交服务未连接」，公开动态和排行也看不到。现在公开内容照常看（同访客），上面一行说原因并给「查看并同意 / 重新登录」
  const offline = WEB_SURFACE && !guest && status !== 'ready'
  const viewAsGuest = guest || offline
  // 子标签、动态范围、找群的搜索词和展开状态记在会话里（lib/pageState）：点进帖子 / 群 / 个人主页再返回，还是离开时的样子
  const [q, setQ] = usePageState('community.groupQ', '', isString)
  // 币详情页「建一个群」跳过来：直接打开建群，并按该币预填群名
  const createFor = (useLocation().state as { createFor?: TokenPreset } | null)?.createFor ?? null
  const [creating, setCreating] = useState(!!createFor)
  const [editing, setEditing] = useState(false)
  // clubs（群组）只在网页版有（CommunityTabs.tsx）；手机 App 里存了也按消息处理
  const [savedTab, setTab] = usePageState<CommunityTab>('community.tab', 'feed', oneOf('feed', 'groups', 'clubs', 'friends', 'rank'))
  // 从币详情「建一个群」跳过来：固定在消息（群）标签
  const tab: CommunityTab = createFor ? 'groups' : !WEB_SURFACE && savedTab === 'clubs' ? 'groups' : savedTab
  const groupish = tab === 'groups' || tab === 'clubs'
  const [scope, setScope] = usePageState<'global' | 'friends'>('community.scope', 'global', oneOf('global', 'friends'))
  // 找群面板开没开也记在会话里：从搜索结果点进群再返回，面板和搜索词都还在
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
  // 发现群最多 100 个（服务端上限），先画 20 个，滚到底再画下一批
  const query = q.trim()
  // 群 + 私信 + 「0x4 官方」公告的未读
  const unread = useCommunityUnread()

  useEffect(() => {
    if (status !== 'ready' || !groupish) return
    let alive = true
    setGroupsLoading(true); setGroupsFailed(false)
    const timeout = setTimeout(() => { if (alive) { setGroupsLoading(false); setGroupsFailed(true) } }, 15_000)
    void useSocial.getState().loadDmList()   // 私信会话列表（服务器上的记录）顺带刷新
    loadGroups().then(() => { if (alive) setGroupsFailed(false) }).catch(() => { if (alive) setGroupsFailed(true) }).finally(() => { clearTimeout(timeout); if (alive) setGroupsLoading(false) })
    return () => { alive = false; clearTimeout(timeout) }
  }, [status, groupish, groupRetry, loadGroups])

  // 搜索独立于会话订阅，取消旧请求，避免慢响应回写到新关键词。
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

  // 不搜的时候只推荐没加入的群；搜索时（比如按群号）已加入的群也要显示，按钮换成「进入」（2026-09-27 goat：搜自己的群号搜不到）
  // 输入过程中先留着上一次的结果（变淡），新结果到了再换，不整块闪成加载框
  const shown = discovery && (discovery.query === query || searchLoading) ? discovery : null
  const others = (shown?.groups ?? []).filter(g => query.trim() || !myGroups.some(m => m.id === g.id))
  // 一次显示 15 个，「显示更多」再往下拿 15 个（2026-09-29 goat：一页不要太长）
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

      {/* 网页版（手机浏览器窄屏）多一个「流媒体」：网页版底部没有单独的直播标签（CommunityTabs.tsx） */}
      {WEB_SURFACE ? <CommunityTabs active={tab} onTab={setTab} unread={unread} /> : <div className="page-gutter grid grid-cols-4 gap-3 border-b border-line" role="group" aria-label={t('社区视图')}>
        {(['feed', 'groups', 'friends', 'rank'] as const).map(v => <button key={v} onClick={() => setTab(v)} aria-pressed={tab === v} className="view-tab relative">{t({ feed: '动态', groups: '消息', friends: '好友', rank: '排行' }[v])}{v === 'groups' && unread > 0 && <span aria-label={t('{n} 条未读', { n: unread })} className="absolute top-1 right-0 h-1.5 w-1.5 rounded-full bg-accent" />}</button>)}
      </div>}
      {/* 公开内容（动态、排行）上面一行说原因；要登录才有的（好友、群、消息）整块说原因 + 按钮 */}
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
      {/* 群组（网页版手机宽度）：我的群在前、发现群在后，和宽屏「群组」页一样（10/03 goat） */}
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
      {/* 2026-09-28 goat：「找群」从列表底下挪到加号旁边，做成放大镜，点开是搜索面板；会话上面加一条「发现社区」，随机展示服务器上建好的群 */}
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

      {/* 推荐关注保留在动态 Tab，继续沿用原有的一次性显示规则。 */}
      {tab === 'feed' && !viewAsGuest && <SuggestFollow />}
      <Sheet open={composing} onClose={() => setComposing(false)} title={t('发布动态')} dismissible={!postBusy}><PostComposer onBusyChange={setPostBusy} onPosted={() => { setPostKey(k => k + 1); setComposing(false) }} /></Sheet>
      <CreateGroupSheet open={creating} preset={createFor} onClose={() => { setCreating(false); if (createFor) { setTab('groups'); nav('/community', { replace: true, state: null }) } }} />
      <ProfileSheet open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

/** 发现社区（2026-09-28 goat）：会话列表上面一条横向滑动的卡片，随机展示服务器上已经建好、自己还没加入的群，最多 10 个，「换一批」重新抽。
 *  要不要审核、有没有门槛都是群主的设置，这里只负责展示；点卡片进群页，群页按群的规则显示加入 / 申请 / 持币要求。
 *  放在会话列表上面、单独一条横向滑动，不占会话的位置，以后加入的群多了也不会和它挤在一起。 */
function DiscoverStrip({ joined }: { joined: Group[] }) {
  const [all, setAll] = useState<Group[] | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let alive = true
    api<Group[]>('/api/groups?q=').then((l) => { if (alive && Array.isArray(l)) setAll(l) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const pool = useMemo(() => { const mine = new Set(joined.map((g) => g.id)); return (all || []).filter((g) => !mine.has(g.id)) }, [all, joined])
  // 每次进页面、每点一次「换一批」重新洗牌；列表更新（比如刚加入一个群）不重洗，免得卡片跳来跳去
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

/** 群名里和搜索词相同的部分（不分大小写，空格隔开的每个词）标成强调色；按群号搜时不标 */
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
  const [gate, setGate] = useState<GateDraft>(emptyDraft()) // 代币或 NFT 门槛
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
