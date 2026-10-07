// 社区 → 动态（/community，2026-10-01 社区合并，设计稿「1-社区-动态」）：
//   中间：全部 / 关注 + 发动态框 + 动态流（复用手机同一个 Feed，交易帖带「持有中」和买入后涨跌）；
//   右边：正在直播（前 3）· 排行（交易 / 小精灵前 3）· 热门社区（前 3，成员盈亏合计）。
// 全部来自真实接口，没有数据就显示空状态，不放示例。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SquarePen } from 'lucide-react'
import Avatar from '@/components/Avatar'
import Feed from '@/components/Feed'
import OfficialBadge from '@/components/OfficialBadge'
import { PostComposer } from '@/components/Posts'
import { RankMedal } from '@/live/Badges'
import { signedMoney } from '@/components/DayPnl'
import { pnlSign } from '@/lib/dayPnl'
import { api, type Fly } from '@/lib/social'
import { t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { useSocial, displayName } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { needLogin, needWallet } from '../walletGate'
import { SocialLogin } from '../ui'
import { useLiveRooms } from '../liveRooms'
import { coverOf } from './covers'
import CommunityShell, { onPosted } from './CommunityShell'

export const toneOf = (v: number) => (pnlSign(v) > 0 ? 'cm-up' : pnlSign(v) < 0 ? 'cm-dn' : 'cm-flat')

export default function FeedView() {
  return <CommunityShell><FeedBody /></CommunityShell>
}

function FeedBody() {
  const { status, onlineCount, wsStatus } = useSocial()
  const connected = useWallet(isWalletConnected)
  const ready = connected && status === 'ready'
  const [scope, setScope] = usePageState<'global' | 'friends'>('community.scope', 'global', oneOf('global', 'friends'))
  const [postKey, setPostKey] = useState(0)
  useEffect(() => onPosted(() => setPostKey((k) => k + 1)), [])
  // 「关注」要登录后才有：没连钱包或社区没连上时一律看全部
  const eff = ready ? scope : 'global'
  return (
    <div className="cm-feedgrid">
      <section className="cm-feed" aria-label={t('社区动态')}>
        <div className="cm-tabs" role="tablist" aria-label={t('动态范围')}>
          <button type="button" role="tab" aria-selected={eff === 'global'} onClick={() => setScope('global')}>{t('全部')}</button>
          <button type="button" role="tab" aria-selected={eff === 'friends'} disabled={connected && !ready} onClick={() => { if (!needWallet() && ready) setScope('friends') }}>{t('关注||count')}</button>
          {ready && wsStatus === 'open' && <span className="cm-tabs-r"><span className="wc-dot is-on" aria-hidden="true" />{t('{n} 人在线', { n: onlineCount })}</span>}
        </div>
        {!connected ? (
          <div className="cm-guest"><SquarePen size={18} aria-hidden="true" /><span>{t('连接 0x4 Wallet 后发动态，你的每笔交易也会自动出现在这里。')}</span><button type="button" className="cm-btn is-sm" onClick={() => { needWallet() }}>{t('连接 0x4 Wallet')}</button></div>
        ) : !ready ? (
          <div className="cm-guest"><SocialLogin bar /></div>
        ) : (
          <div className="cm-compose"><PostComposer onPosted={() => setPostKey((k) => k + 1)} /></div>
        )}
        <div className="wc-feed"><Feed scope={eff} refreshKey={postKey} /></div>
      </section>
      <aside className="cm-rail" aria-label={t('发现')}>
        <LiveRail />
        <RankRail />
        <HotCommunities />
      </aside>
    </div>
  )
}

/** 右栏：正在直播（看的人最多的 3 个） */
function LiveRail() {
  const nav = useNavigate()
  const rooms = useLiveRooms((s) => s.rooms)
  const failed = useLiveRooms((s) => s.failed)
  const top = (rooms ?? []).slice(0, 3)
  return (
    <section className="cm-mod" aria-labelledby="cm-lr-t">
      <div className="cm-mod-h"><b id="cm-lr-t">{t('正在直播')}</b><Link to="/live" className="cm-link">{t('看全部')}</Link></div>
      {!rooms ? (failed ? <p className="cm-mod-empty">{t('暂时无法加载直播房间')}</p> : <div className="flex flex-col gap-3 py-2">{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 56 }} />)}</div>)
        : !top.length ? <p className="cm-mod-empty">{t('暂无正在直播的房间')}</p>
          : top.map((r) => (
            <button key={r.id} type="button" className="cm-lv w-full text-left" onClick={() => { if (!needLogin()) nav(`/room/${r.id}`) }} aria-label={t('进入 {title}', { title: r.title })}>
              <span className="cm-thumb">
                <img className="cm-cover" src={coverOf(r.id, r.cover)} alt="" loading="lazy" decoding="async" />
                <span className="cm-thumb-av"><Avatar address={r.host} src={r.hostAvatar} name={r.hostNickname} size={30} /></span>
                <span className="cm-lb">LIVE</span>
                {r.pk && <span className="cm-pkb">PK</span>}
              </span>
              <span className="cm-lv-b">
                <span className="cm-lv-t">{r.title}</span>
                <span className="cm-lv-s"><span>{displayName({ address: r.host, nickname: r.hostNickname })}</span><span className="num">{r.kind === 'voice' ? t('{n} 人在听', { n: r.viewers }) : t('{n} 人在看', { n: r.viewers })}</span></span>
              </span>
            </button>
          ))}
    </section>
  )
}

interface LbRow { address: string; nickname: string | null; avatar: string | null; pnl: number; n: number }

/** 右栏：排行（交易 = 24 小时盈亏前 3；小精灵 = 账户盈亏前 3） */
function RankRail() {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const [tab, setTab] = usePageState<'trade' | 'sprite'>('community.railRank', 'trade', oneOf('trade', 'sprite'))
  const [trade, setTrade] = useState<LbRow[] | null>(null)
  const [flies, setFlies] = useState<Fly[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setFailed(false)
    if (tab === 'trade') api<{ list: LbRow[] }>('/api/leaderboard?period=24h').then((b) => { if (alive) setTrade(Array.isArray(b?.list) ? b.list : []) }).catch(() => { if (alive) setFailed(true) })
    else api<{ list: Fly[] }>('/api/flies').then((r) => { if (alive) setFlies(Array.isArray(r?.list) ? r.list : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [tab, status])
  const sprites = useMemo(() => [...(flies ?? [])].filter((f) => f.activated && !f.pnlHidden && f.pnl != null).sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)).slice(0, 3), [flies])
  const list = tab === 'trade' ? trade : flies
  return (
    <section className="cm-mod" aria-labelledby="cm-rr-t">
      <div className="cm-mod-h"><b id="cm-rr-t">{t('排行')}</b><Link to={tab === 'sprite' ? '/rank?tab=sprite' : '/rank'} className="cm-link">{t('完整排行')}</Link></div>
      <div className="cm-seg" role="group" aria-label={t('排行类型')}>
        <button type="button" aria-pressed={tab === 'trade'} onClick={() => setTab('trade')}>{t('交易')}</button>
        <button type="button" aria-pressed={tab === 'sprite'} onClick={() => setTab('sprite')}>{t('小精灵')}</button>
      </div>
      {failed && !list ? <p className="cm-mod-empty">{t('暂时无法加载排行')}</p>
        : !list ? <div className="flex flex-col gap-3 py-2">{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 40 }} />)}</div>
          : tab === 'trade' ? (!trade!.length ? <p className="cm-mod-empty">{t('24 小时内还没有人交易')}</p>
            : trade!.slice(0, 3).map((r, i) => (
              <Link key={r.address} to={`/u/${r.address}`} className="cm-rk">
                <span className="cm-rk-no"><RankMedal rank={i + 1} size={24} /></span>
                <Avatar address={r.address} src={r.avatar} name={r.nickname} size={34} />
                <span className="cm-rk-b"><b>{displayName(r)}</b><small className="num">{t('{n} 笔成交', { n: r.n })}</small></span>
                <span className={`cm-rk-v ${toneOf(r.pnl)}`}>{signedMoney(r.pnl)}</span>
              </Link>)))
            : (!sprites.length ? <p className="cm-mod-empty">{t('还没有公开盈亏的小精灵')}</p>
              : sprites.map((f, i) => (
                <button key={f.id} type="button" className="cm-rk w-full text-left" onClick={() => { if (!needWallet()) nav(`/fly/${f.id}`) }}>
                  <span className="cm-rk-no"><RankMedal rank={i + 1} size={24} /></span>
                  <Avatar address={f.address} name={f.name} size={34} />
                  <span className="cm-rk-b"><b>{f.name}</b><small>{t('{owner} 的小精灵', { owner: f.ownerNickname || `${f.owner.slice(0, 6)}…` })}</small></span>
                  <span className={`cm-rk-v ${toneOf(f.pnl ?? 0)}`}>{signedMoney(f.pnl ?? 0)}</span>
                </button>)))}
    </section>
  )
}

export interface Community { id: string; name: string; avatar: string | null; members: number; pnl: number; official?: number | boolean | null }

/** 右栏：热门社区（/api/communities：一个群就是一个社区，按成员盈亏合计排，前 3） */
function HotCommunities() {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const [list, setList] = useState<Community[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    api<Community[]>('/api/communities').then((l) => { if (alive) setList(Array.isArray(l) ? [...l].sort((a, b) => b.pnl - a.pnl) : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [status])
  return (
    <section className="cm-mod" aria-labelledby="cm-hc-t">
      <div className="cm-mod-h"><b id="cm-hc-t">{t('热门社区')}</b><Link to="/rank?tab=community" className="cm-link">{t('全部')}</Link></div>
      {failed && !list ? <p className="cm-mod-empty">{t('暂时无法加载社区')}</p>
        : !list ? <div className="flex flex-col gap-3 py-2">{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 40 }} />)}</div>
          : !list.length ? <p className="cm-mod-empty">{t('还没有群上榜')}</p>
            : list.slice(0, 3).map((c) => (
              <button key={c.id} type="button" className="cm-rk w-full text-left" onClick={() => { if (!needWallet()) nav(`/g/${c.id}`) }}>
                <Avatar address={c.id} src={c.avatar} name={c.name} size={38} />
                <span className="cm-rk-b"><b>{c.name}{!!c.official && <OfficialBadge size={13} />}</b><small className="num">{t('{n} 成员', { n: c.members })}</small></span>
                <span className={`cm-rk-v ${toneOf(c.pnl)}`}>{signedMoney(c.pnl)}</span>
              </button>))}
    </section>
  )
}
