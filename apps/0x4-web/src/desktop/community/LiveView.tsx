// 社区 → 直播（/live，2026-10-01 社区合并，设计稿「2-社区-直播」）：
//   页头：直播 + 「PK 排行」「开直播」；
//   有主播在 PK 时最上面一张大卡：两边房间 + 比分盘口（K 线式：领先的一方往上涨、落后的往下跌，数据是这一局真实的比分走势）；
//   下面三列：其它正在直播的房间（封面插画 + 主播头像、LIVE / 付费 / 语音、人数、标题、主播）。
// 房间列表和顶栏红点、左边菜单数字同一份（liveRooms.ts）；PK 状态每 3 秒拉一次公开接口 /api/rooms/:id/pk。
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Radio, RefreshCw, WifiOff } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RankSheet from '@/live/RankSheet'
import { StreakBadge } from '@/live/Badges'
import { LIVE_IMG } from '@/live/img'
import { mmss, useTicker, type PkState } from '@/live/pk'
import { CreateRoomSheet, type RoomInfo } from '@/pages/Live'
import { api } from '@/lib/social'
import { fmtAmount, timeAgo } from '@/lib/format'
import { t } from '@/lib/i18n'
import { useSocial, displayName } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { needLogin } from '../walletGate'
import { SocialLogin } from '../ui'
import { useLiveRooms } from '../liveRooms'
import { coverOf } from './covers'
import CommunityShell from './CommunityShell'
import { StreamHead } from './StreamHead'

export default function LiveView() {
  return <CommunityShell><LiveBody /></CommunityShell>
}

function LiveBody() {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const appLogin = useSocial((s) => s.qrMode && s.status === 'ready')
  const connected = useWallet(isWalletConnected) || appLogin
  const { rooms, livekit, failed, refresh, loading } = useLiveRooms()
  const [creating, setCreating] = useState(false)
  const [ranking, setRanking] = useState(false)
  const avOk = livekit !== false
  // 连了钱包但社区 / 音视频没就绪：开播按钮置灰，原因在页头下面说一次
  const liveBlock = connected && (status !== 'ready' || !avOk)
  const goLive = () => { if (!needLogin()) setCreating(true) }
  const enter = (id: string) => { if (!needLogin()) nav(`/room/${id}`) }
  // 正在 PK 的房间里挑看的人最多的一个做大卡；它和对面房间不再出现在下面的列表里
  const featured = useMemo(() => (rooms ?? []).find((r) => r.pk && r.pk.phase !== 'linked') ?? null, [rooms])
  const pk = usePk(featured?.id ?? null)
  const others = useMemo(() => (rooms ?? []).filter((r) => !featured || (r.id !== featured.id && r.id !== pk?.opp.room)), [rooms, featured, pk])

  return (
    <>
      <StreamHead mode="live" sub={t('看主播聊币、PK，喜欢就送个礼物')} extra={<button type="button" className="cm-btn is-quiet" onClick={() => setRanking(true)}><img src={LIVE_IMG.streak} alt="" width={18} height={18} />{t('PK 排行')}</button>} />
      <SocialLogin bar />
      {livekit === false && <div className="wc-note is-warn" role="status"><WifiOff size={15} aria-hidden="true" /><span>{t('音视频服务暂不可用')}</span></div>}

      {featured && pk && <PkHero room={featured} pk={pk} onEnter={() => enter(featured.id)} coverFor={(id) => coverOf(id, rooms?.find((x) => x.id === id)?.cover)} />}

      {!rooms ? (failed
        ? <div className="cm-panel cm-empty"><WifiOff size={26} aria-hidden="true" /><span>{t('暂时无法加载直播房间')}</span><button type="button" className="cm-btn is-quiet is-sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={13} />{t('重试')}</button></div>
        : <div className="lv-grid">{[0, 1, 2].map((i) => <span key={i} className="cm-sk lv-sk" />)}</div>)
        : !rooms.length ? <div className="cm-panel cm-empty"><Radio size={26} aria-hidden="true" /><span>{t('暂无正在直播的房间')}</span><button type="button" className="cm-btn is-red is-sm" onClick={goLive} disabled={liveBlock}>{t('开直播')}</button></div>
          : others.length > 0 && <div className="lv-grid">{others.map((r) => <RoomTile key={r.id} r={r} onEnter={() => enter(r.id)} disabled={!avOk} />)}</div>}

      <CreateRoomSheet open={creating} onClose={() => setCreating(false)} />
      <RankSheet open={ranking} onClose={() => setRanking(false)} />
    </>
  )
}

/** 某个房间的 PK 状态：每 3 秒拉一次；倒计时用服务器时间 */
function usePk(roomId: string | null): (PkState & { skew: number }) | null {
  const [pk, setPk] = useState<(PkState & { skew: number }) | null>(null)
  useEffect(() => {
    if (!roomId) { setPk(null); return }
    let alive = true
    const load = () => api<{ pk: PkState | null }>(`/api/rooms/${roomId}/pk`, {}, { anonymous: true })
      .then((r) => { if (alive) setPk(r?.pk ? { ...r.pk, skew: r.pk.serverNow - Date.now() } : null) })
      .catch(() => { /* 下一轮再拉 */ })
    void load()
    const id = setInterval(() => { if (!document.hidden) void load() }, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [roomId])
  return pk
}

/** PK 大卡：左边这个房间、右边对面房间；下面是比分盘口 */
function PkHero({ room, pk, onEnter, coverFor }: { room: RoomInfo; pk: PkState & { skew: number }; onEnter: () => void; coverFor: (id: string) => string }) {
  useTicker(pk.phase === 'running', 1000)
  const left = pk.me, right = pk.opp
  const remain = pk.endsAt - (Date.now() + pk.skew)
  const share = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0.5)
  const leftShare = share(left.score, right.score)
  const series = (pk.history?.length ? pk.history : [{ t: pk.startedAt, me: 0, opp: 0 }]).map((h) => ({ t: h.t, v: share(h.me, h.opp) }))
  const end = pk.phase === 'running' ? Date.now() + pk.skew : (pk.history?.at(-1)?.t ?? pk.endsAt)
  const leftLead = leftShare >= 0.5
  return (
    <section className="cm-hero" aria-label={t('{a} 和 {b} 正在 PK', { a: left.nickname, b: right.nickname })}>
      <div className="cm-hero-half">
        <img className="cm-cover" src={coverFor(left.room)} alt="" decoding="async" />
        <span className="cm-hero-av"><Avatar address={left.host} src={left.avatar} name={left.nickname} size={84} /></span>
      </div>
      <div className="cm-hero-half">
        <img className="cm-cover" src={coverFor(right.room)} alt="" decoding="async" />
        <span className="cm-hero-av"><Avatar address={right.host} src={right.avatar} name={right.nickname} size={84} /></span>
      </div>
      <div className="cm-hero-tl">
        <span className="cm-livetag">LIVE</span>
        {left.streak >= 2 && <span className="cm-glass"><StreakBadge n={left.streak} size={14} /></span>}
      </div>
      <div className="cm-hero-tr">
        <span className="cm-glass num">{room.kind === 'voice' ? t('{n} 人在听', { n: room.viewers }) : t('{n} 人在看', { n: room.viewers })}</span>
        <button type="button" className="cm-btn" onClick={onEnter}>{t('进入直播间')}</button>
      </div>
      <div className="cm-book">
        <div className="cm-book-side">
          <Avatar address={left.host} src={left.avatar} name={left.nickname} size={44} />
          <span><span className="nm">{left.nickname}</span><span className={`sc ${leftLead ? 'cm-up' : 'cm-dn'}`}>{left.score.toLocaleString()}</span></span>
        </div>
        <ShareChart series={series} start={pk.startedAt} end={end} invert={false} label={leftShare} side="l" />
        <div className="cm-vs"><b>VS</b><span>{pk.phase === 'running' ? t('剩 {time}', { time: mmss(remain) }) : pk.winner === 'tie' ? t('平局') : t('本局结束')}</span></div>
        <ShareChart series={series} start={pk.startedAt} end={end} invert label={1 - leftShare} side="r" />
        <div className="cm-book-side is-r">
          <Avatar address={right.host} src={right.avatar} name={right.nickname} size={44} />
          <span><span className="nm">{right.nickname}</span><span className={`sc ${leftLead ? 'cm-dn' : 'cm-up'}`}>{right.score.toLocaleString()}</span></span>
        </div>
      </div>
    </section>
  )
}

/**
 * K 线式比分：把这一局的时间切成若干段，每段一根蜡烛（开 = 段首占比、收 = 段末占比、高低 = 段内最高最低）。
 * 左图画「左边占比」，右图画「右边占比」（= 1 - 左边），所以领先的一方一路涨（绿）、落后的一方一路跌（红）。
 * 还没人送礼时是一条 50% 的平线。只用真实比分点，不插值编数据。
 */
function ShareChart({ series, start, end, invert, label, side }: { series: { t: number; v: number }[]; start: number; end: number; invert: boolean; label: number; side: 'l' | 'r' }) {
  const N = 22
  const W = 300, H = 100, PAD = 8
  const span = Math.max(1, end - start)
  const val = (v: number) => (invert ? 1 - v : v)
  const candles = useMemo(() => {
    const out: { o: number; c: number; h: number; l: number }[] = []
    let last = val(series[0]?.v ?? 0.5)
    let i = 0
    for (let k = 0; k < N; k++) {
      const segEnd = start + (span * (k + 1)) / N
      const o = last
      let h = o, l = o
      while (i < series.length && series[i].t <= segEnd) { const v = val(series[i].v); h = Math.max(h, v); l = Math.min(l, v); last = v; i++ }
      out.push({ o, c: last, h, l })
    }
    return out
  }, [series, start, span, invert]) // eslint-disable-line react-hooks/exhaustive-deps
  const y = (v: number) => PAD + (1 - v) * (H - PAD * 2)
  const step = W / N
  const up = label >= 0.5
  return (
    <div className={`cm-chart is-${side}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={y(0.5)} y2={y(0.5)} stroke="rgb(255 255 255 / .08)" strokeDasharray="3 4" />
        {candles.map((c, k) => {
          const x = k * step + step / 2
          const rise = c.c >= c.o
          const color = rise ? '#2fd49a' : '#ff6b7a'
          const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c))
          return <g key={k}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="1.2" />
            <rect x={x - step * 0.3} width={step * 0.6} y={top} height={Math.max(2, bot - top)} rx="1" fill={color} />
          </g>
        })}
      </svg>
      <span className={`cm-tick ${up ? 'up' : 'dn'}`}>{up ? '▲' : '▼'} {(label * 100).toFixed(1)}%</span>
    </div>
  )
}

/**
 * 一个直播间卡片（2026-10-02 goat：原来的卡片很丑、标题被下一行压住，重做）：
 *   封面 = 主播选的直播间氛围图（压暗做底），中间主播头像，外面一圈慢慢转的渐变光环 + 两圈往外扩的波纹 = 正在播；
 *   左上 LIVE（红点闪）/ PK / 付费，右上观看人数，标题压在封面底部（最多两行），下面一行主播、连胜、开播多久。
 *   鼠标移上去整张卡微微上浮发光、封面慢慢放大。
 */
function RoomTile({ r, onEnter, disabled }: { r: RoomInfo; onEnter: () => void; disabled: boolean }) {
  const name = displayName({ address: r.host, nickname: r.hostNickname })
  return (
    <button type="button" className="lv-card" onClick={onEnter} disabled={disabled} aria-label={t('进入 {title}', { title: r.title })}>
      <span className="lv-thumb">
        <img className="lv-bg" src={coverOf(r.id, r.cover)} alt="" loading="lazy" decoding="async" />
        <span className="lv-av" aria-hidden="true"><i /><i /><Avatar address={r.host} src={r.hostAvatar} name={r.hostNickname} size={64} /></span>
        <span className="lv-tl">
          <span className="lv-live"><i />LIVE</span>
          {r.pk && <span className="lv-chip is-pk">PK</span>}
          {r.price > 0 && <span className="lv-chip">{t('付费')} · {fmtAmount(r.price)} {r.priceSymbol}</span>}
        </span>
        <span className="lv-vw num"><Eye size={13} aria-hidden="true" />{r.viewers.toLocaleString()}</span>
        <span className="lv-title">{r.title}</span>
      </span>
      <span className="lv-meta">
        <Avatar address={r.host} src={r.hostAvatar} name={r.hostNickname} size={26} />
        <span className="lv-name">{name}</span>
        {(r.streak ?? 0) >= 2 && <StreakBadge n={r.streak} size={12} />}
        <span className="lv-ago">{t('{time}开播', { time: timeAgo(r.createdAt) })}</span>
      </span>
    </button>
  )
}
