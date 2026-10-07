// Community → messages (/messages) and groups (/groups) (2026-10-01 community merge).
//   Messages: my conversations (groups + DMs + 0x4 official, same ChatList as phone "messages"); tap one for the chat window (/g/:id, /dm/:address, /official);
//   Groups: my groups / discover groups (search by name or id); create, join, request. Public groups viewable without a wallet.
//   2026-10-03 goat: "my groups" first and open by default; with no groups joined, show a hint plus an "explore more groups" button (switches to discover).
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Lock, MessageCircle, Plus, RefreshCw, Search, UserRound, Users } from 'lucide-react'
import Avatar from '@/components/Avatar'
import OfficialBadge from '@/components/OfficialBadge'
import ChatList from '@/components/ChatList'
import { toast } from '@/components/Toast'
import { CreateGroupSheet, type TokenPreset } from '@/pages/Community'
import { api, type Group } from '@/lib/social'
import { t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { errorText } from '@/lib/errors'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { needLogin } from '../walletGate'
import { SocialLogin } from '../ui'
import CommunityShell, { CmHead } from './CommunityShell'
import Friends from '@/components/Friends'

/** The conversation list needs community login; fetch groups and DMs once logged in */
function useChatsReady() {
  const wallet = useWallet(isWalletConnected)
  const status = useSocial((s) => s.status)
  const qr = useSocial((s) => s.qrMode)
  const loadGroups = useSocial((s) => s.loadGroups)
  // Wallet-connected or phone-app QR-logged-in both count as logged in (2026-10-04 review: previously wallet-only, so QR users couldn't see their groups or messages;
  // QR login covers groups; DMs need wallet encryption — entering a DM when the server replies WALLET_REQUIRED pops the wallet connect)
  const connected = wallet || (qr && status === 'ready')
  const ready = connected && status === 'ready'
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!ready) return
    let alive = true
    setLoading(true); setFailed(false)
    void useSocial.getState().loadDmList()
    loadGroups().then(() => { if (alive) setFailed(false) }).catch(() => { if (alive) setFailed(true) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [ready, retry, loadGroups])
  return { connected, ready, loading, failed, retry: () => setRetry((n) => n + 1) }
}

export function MessagesView() {
  return <CommunityShell><MessagesBody /></CommunityShell>
}
function MessagesBody() {
  const s = useChatsReady()
  return (
    <>
      <CmHead title={t('消息')} sub={t('群聊、私信和 0x4 官方公告')} />
      <section className="cm-panel" style={{ overflow: 'hidden' }}>
        {!s.connected ? <div className="cm-empty"><MessageCircle size={26} aria-hidden="true" /><span>{t('连接 0x4 Wallet 后显示你的群和私信。')}</span><button type="button" className="cm-btn is-sm" onClick={() => { needLogin() }}>{t('连接 0x4 Wallet')}</button></div>
          : !s.ready ? <div className="cm-empty"><SocialLogin row={false} /></div>
            : <div className="wc-chats"><ChatList loading={s.loading} failed={s.failed} onRetry={s.retry} /></div>}
      </section>
    </>
  )
}

/** Public group list (/api/groups?q=, readable without login) */
function usePublicGroups(query: string) {
  const [st, set] = useState<{ list: Group[] | null; failed: boolean }>({ list: null, failed: false })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const id = setTimeout(() => {
      api<Group[]>(`/api/groups?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((l) => { if (alive) set({ list: Array.isArray(l) ? l : [], failed: !Array.isArray(l) }) })
        .catch(() => { if (alive) set((c) => ({ ...c, failed: true })) })
    }, query ? 250 : 0)
    return () => { alive = false; clearTimeout(id); ctrl.abort() }
  }, [query, retry])
  return { ...st, retry: () => setRetry((n) => n + 1) }
}

/** Friends (2026-10-04 review: desktop had no friend list or people search; phone community has a "friends" tab). Reuse the phone Friends block directly: friends, requests, search, suggestions */
export function FriendsView() {
  return <CommunityShell><FriendsBody /></CommunityShell>
}
function FriendsBody() {
  const s = useChatsReady()
  return (
    <>
      <CmHead title={t('好友')} sub={t('互相关注就是好友，可以私聊；也能在这里搜人。')} />
      {!s.connected
        ? <div className="cm-panel"><div className="cm-empty"><UserRound size={26} aria-hidden="true" /><span>{t('连接 0x4 Wallet 后显示你的好友。')}</span><button type="button" className="cm-btn is-sm" onClick={() => { needLogin() }}>{t('连接 0x4 Wallet')}</button></div></div>
        : <div className="cm-panel cm-friends"><Friends /></div>}
    </>
  )
}

export function GroupsView() {
  return <CommunityShell><GroupsBody /></CommunityShell>
}
function GroupsBody() {
  const s = useChatsReady()
  const myGroups = useSocial((x) => x.myGroups)
  const [tab, setTab] = usePageState<'mine' | 'find'>('community.groups', 'mine', oneOf('mine', 'find'))
  const [q, setQ] = useState('')
  // Coin detail's "create a group" arrives with a preset (state.createFor): open group creation with the name prefilled (2026-10-04 review: previously landed on the feed and nothing happened)
  const createFor = (useLocation().state as { createFor?: TokenPreset } | null)?.createFor ?? null
  const [creating, setCreating] = useState(!!createFor)
  const found = usePublicGroups(q.trim())
  const eff = s.ready ? tab : 'find'
  const list = eff === 'mine' ? myGroups : found.list
  return (
    <>
      <CmHead title={t('群组')} sub={t('加入群组，和大家一起聊行情。')} right={<button type="button" className="cm-btn" onClick={() => { if (!needLogin()) setCreating(true) }} disabled={s.connected && !s.ready}><Plus size={16} />{t('创建群')}</button>} />
      <div className="cm-filters">
        <div className="cm-seg" role="group" aria-label={t('群组')}>
          <button type="button" aria-pressed={eff === 'mine'} onClick={() => { if (!needLogin() && s.ready) setTab('mine') }}>{t('我的群')}</button>
          <button type="button" aria-pressed={eff === 'find'} onClick={() => setTab('find')}>{t('发现群')}</button>
        </div>
        {eff === 'find' && <label className="wc-input" style={{ width: 320 }}><Search size={14} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('输入群号或群名')} aria-label={t('搜索群名或群号')} spellCheck={false} /></label>}
      </div>
      <section className="cm-panel" style={{ overflow: 'hidden' }}>
        {eff === 'find' && found.failed && !found.list ? <div className="cm-empty"><span>{t('暂时无法加载群列表')}</span><button type="button" className="cm-btn is-quiet is-sm" onClick={found.retry}><RefreshCw size={13} />{t('重试')}</button></div>
          : !list ? <div className="flex flex-col gap-3 p-4">{[0, 1, 2, 3].map((i) => <span key={i} className="cm-sk" style={{ height: 48 }} />)}</div>
            : !list.length ? (eff === 'mine'
              ? <div className="cm-empty"><Users size={26} aria-hidden="true" /><span>{t('当前还没有加入任何群组')}</span><button type="button" className="cm-btn is-sm" onClick={() => setTab('find')}>{t('探索更多群组')}</button></div>
              : <div className="cm-empty"><Users size={26} aria-hidden="true" /><span>{q.trim() ? t('没有找到匹配的群') : t('还没有公开群')}</span></div>)
              : <ul>{list.map((g) => <li key={g.id}><GroupRow g={g} connected={s.connected} /></li>)}</ul>}
      </section>
      <CreateGroupSheet open={creating} preset={createFor} onClose={() => setCreating(false)} />
    </>
  )
}

/** One group row: avatar, name (official badge), member count, threshold / review; join / enter on the right */
function GroupRow({ g, connected }: { g: Group; connected: boolean }) {
  const nav = useNavigate()
  const myGroups = useSocial((s) => s.myGroups)
  const joinGroup = useSocial((s) => s.joinGroup)
  const [busy, setBusy] = useState(false)
  const joined = connected && myGroups.some((m) => m.id === g.id)
  const join = async () => {
    if (needLogin() || busy) return
    setBusy(true)
    try { await joinGroup(g.id); nav(`/g/${g.id}`) } catch (e) { const err = e as Error & { pending?: boolean }; if (err.pending) toast.success(err.message); else toast.error(errorText(err, t('加入失败'))) } finally { setBusy(false) }
  }
  return (
    <div className="cm-mrow" style={{ padding: '14px 20px' }}>
      <Link to={`/g/${g.id}`} className="cm-rrow-who" style={{ flex: 1 }} onClick={(e) => { if (needLogin()) e.preventDefault() }}>
        <Avatar address={g.id} src={g.avatar} name={g.name} size={44} />
        <span><b>{g.name}{g.official === true && <OfficialBadge size={14} />}</b>
          <small className="flex items-center gap-1"><Users size={11} aria-hidden="true" /><span className="num">{t('{n} 人', { n: g.memberCount })}</span>{g.gate ? <> · <Lock size={10} aria-label={t('需持币')} />{g.gate.symbol}</> : g.joinMode === 'approval' ? <> · {t('需审核')}</> : null}</small></span>
      </Link>
      {joined ? <button type="button" className="cm-btn is-quiet is-sm" onClick={() => nav(`/g/${g.id}`)}>{t('进入')}</button>
        : <button type="button" className="cm-btn is-sm" disabled={busy} onClick={() => void join()}>{busy ? t('处理中…') : g.joinMode === 'approval' ? t('申请') : t('加入')}</button>}
    </div>
  )
}
