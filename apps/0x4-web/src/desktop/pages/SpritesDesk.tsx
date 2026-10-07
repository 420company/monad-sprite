// 网页版「小精灵」（/flies 宽屏，2026-09-29 goat 第三轮：「小精灵页面的排版设计我也不满意」）。版式（docs/WEB_DESIGN.md）：
//   页头整宽横幅：左边 CYBER EDEN 角标、标题、说明、进入赛博伊甸园；右边三个真实统计；背景是官网小精灵页同款插画（只在横幅里）。
//   我的小精灵：一个面板里的卡片网格（Zalien 卡、赠送名额、没挂卡的小精灵），自己的在跑的排前面，默认两行、多的点「展开全部」；没连钱包 / 读不到 / 没有卡，各自一句话 + 一个操作。
//   此刻的伊甸园：4 列卡片网格，卡片统一高度。排行挪到「排行」页，这里不再放右栏。
// 只用接口给的真实数据（/api/flies、/api/life、/api/flies/mine/all、/api/zalien/cards），失败显示空状态和重试；没有假的围观小精灵、假价格。
// 领养规则、文案和手机「我的小精灵」（pages/Flies.tsx MyZaliens）一致，这里只换成电脑端的横向卡片。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Brain, Gift, Info, Link2, MapPin, Plus, RefreshCw, Sparkles, Wallet, WifiOff } from 'lucide-react'
import Avatar from '@/components/Avatar'
import FlySheet from '@/components/FlySheet'
import WalletLinkSheet from '@/components/WalletLinkSheet'
import { pnlText } from '@/pages/Flies'
import { GAME_URL } from '@/pages/FlyWatch'
import { api, type Fly, type FlyPlan, type FlyPlanDef, type ZalienCard, type ZalienCards } from '@/lib/social'
import { BALANCE_FEATURES } from '@/lib/features'
import { fmtAmount, fmtUsd, timeAgo } from '@/lib/format'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { locale, t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { needWallet } from '../walletGate'
import { Empty, SocialLogin } from '../ui'
import edenArt from '../assets/eden-neurons.webp'

interface LifeRow { id: string; online: boolean; expired: boolean; life: { floor: 'F1' | 'F2' | 'F3'; text: string; textEn: string; symbol: string | null }; decision: { side: string | null; symbol: string | null; execution: string | null; ts: number; spikes: number | null } | null }
type Cap = { capacity: number; remaining: number; plans: Record<FlyPlan, FlyPlanDef> }
type Grant = { plan: FlyPlan; months: number; note: string | null } | null

const floorName = (f: string) => f === 'F1' ? t('教堂') : f === 'F3' ? t('派对广场') : t('房间')
// 日期跟随 App 语言，不跟浏览器语言
const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })

export default function SpritesDesk() {
  const nav = useNavigate()
  const { status, me } = useSocial()
  const connected = useWallet(isWalletConnected)
  const [list, setList] = useState<Fly[] | null>(null)
  const [lives, setLives] = useState<Record<string, LifeRow>>({})
  const [loadErr, setLoadErr] = useState(false)
  const [cap, setCap] = useState<Cap | null>(null)
  const [workerOk, setWorkerOk] = useState(true)
  const [grant, setGrant] = useState<Grant>(null)
  const [revision, setRevision] = useState(0)
  // 我的小精灵（和手机小精灵页同一套接口）
  const [mine, setMine] = useState<Fly[] | undefined>(undefined)
  const [mineErr, setMineErr] = useState(false)
  const [cards, setCards] = useState<ZalienCards | null>(null)
  const [cardsErr, setCardsErr] = useState<string | null>(null)
  const [claim, setClaim] = useState<{ tokenId: number; free: boolean } | null>(null)
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState(false)
  const reload = () => setRevision((n) => n + 1)

  // 公开的小精灵列表 + 生活状态：进页面拉一次，之后每分钟刷新（标签页在后台时跳过）
  useEffect(() => {
    const ctrl = new AbortController()
    let first = true
    const run = () => {
      // 第一次一定取（后台标签里打开也要有数据）；之后的定时刷新在后台时跳过
      if (!first && document.hidden) return
      first = false
      api<{ workerConfigured: boolean; capacity: number; remaining: number; plans: Record<FlyPlan, FlyPlanDef>; grant: Grant; list: Fly[] }>('/api/flies', { signal: ctrl.signal })
        .then((r) => { if (ctrl.signal.aborted) return; setList(Array.isArray(r.list) ? r.list : []); setWorkerOk(r.workerConfigured); setCap({ capacity: r.capacity, remaining: r.remaining, plans: r.plans }); setGrant(r.grant); setLoadErr(false) })
        .catch(() => { if (!ctrl.signal.aborted) setLoadErr(true) })
      api<{ list: LifeRow[] }>('/api/life', { signal: ctrl.signal })
        .then((r) => { if (!ctrl.signal.aborted) setLives(Object.fromEntries(r.list.map((x) => [x.id, x]))) })
        .catch(() => { /* 生活状态拿不到：卡片上不显示这一行，不影响列表 */ })
    }
    run()
    const id = window.setInterval(run, 60_000)
    const onVis = () => { if (!document.hidden) run() }   // 从后台切回来马上刷新，不用等下一分钟
    document.addEventListener('visibilitychange', onVis)
    return () => { ctrl.abort(); window.clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [status, me?.address, revision])

  useEffect(() => {
    if (status !== 'ready' || !connected) { setMine(connected ? undefined : []); return }
    const ctrl = new AbortController()
    setMine(undefined); setMineErr(false); setCards(null); setCardsErr(null)
    api<{ list: Fly[] }>('/api/flies/mine/all', { signal: ctrl.signal }).then((r) => setMine(r.list)).catch(() => { if (!ctrl.signal.aborted) setMineErr(true) })
    // 查卡失败（链上节点暂时不通）不影响看自己的小精灵，只在卡片区提示
    api<ZalienCards>('/api/zalien/cards', { signal: ctrl.signal }).then(setCards).catch((e) => { if (!ctrl.signal.aborted) setCardsErr(errorText(e, t('加载失败，稍后再试'))) })
    return () => ctrl.abort()
  }, [status, connected, me?.address, revision])

  const all = useMemo(() => list ?? [], [list])
  const online = all.filter((f) => f.online).length
  // 卡片墙：在线的排前面，其次按最近一次动作
  const wall = useMemo(() => [...all].sort((a, b) => Number(b.online) - Number(a.online) || (b.lastTickAt ?? 0) - (a.lastTickAt ?? 0)), [all])
  const lifeText = useMemo(() => Object.fromEntries(Object.values(lives).map((x) => [x.id, locale() === 'en-US' ? x.life.textEn : x.life.text])), [lives])
  const open = (f: Fly) => { if (!needWallet()) nav(`/fly/${f.id}`) }
  const lang = locale() === 'en-US' ? 'en' : 'zh'
  // 进入赛博伊甸园（2026-09-30 goat：网页版点进去又要扫码）：已登录就先向服务器换一个 60 秒、只能用一次的游戏登录凭证，
  // 放在网址 # 后面打开游戏，游戏换成自己的令牌直接进（server/src/meetAuth.ts /api/game/handoff）。没登录或换失败就照常打开，游戏里再扫码。
  // 先同步开一个空白窗口再改地址：等接口回来再 window.open 会被浏览器当成弹窗拦掉
  const enterGame = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (useSocial.getState().status !== 'ready') return
    e.preventDefault()
    const url = `${GAME_URL}?lang=${lang}`
    const w = window.open('about:blank', '_blank')
    if (!w) { location.href = url; return }
    w.opener = null
    api<{ code: string }>('/api/game/handoff', { method: 'POST', body: '{}' })
      .then((r) => { w.location.href = r?.code ? `${url}#handoff=${encodeURIComponent(r.code)}` : url })
      .catch(() => { w.location.href = url })
  }

  return (
    <div className="wc-page">
      {/* 页头横幅：插画只在这一块里 */}
      <section className="wc-eden" aria-labelledby="wc-eden-t">
        <img className="wc-eden-art" src={edenArt} alt="" aria-hidden="true" decoding="async" />
        <div>
          <span className="wc-eden-badge">CYBER EDEN</span>
          <h1 id="wc-eden-t" className="wc-eden-title">{t('小精灵')}</h1>
          <p className="wc-eden-text">{t('你的小精灵全天候为你交易，它生活在赛博伊甸园中。')}</p>
          <div className="wc-eden-act">
            <a className="wc-btn is-primary" href={`${GAME_URL}?lang=${lang}`} target="_blank" rel="noreferrer" onClick={enterGame}>{t('进入赛博伊甸园')}<ArrowUpRight size={15} /></a>
            <span>{t('持有 Zalien NFT 即可领养，看它学着看盘。')}</span>
          </div>
        </div>
        <dl className="wc-eden-stats">
          <div><dt>{t('小精灵')}</dt><dd>{list ? all.length : '--'}</dd></div>
          <div><dt>{t('在线')}</dt><dd className="wc-up">{list ? online : '--'}</dd></div>
          <div><dt>{t('本月剩余名额')}</dt><dd>{cap ? <>{cap.remaining}<small> / {cap.capacity}</small></> : '--'}</dd></div>
        </dl>
      </section>
      {cap && !workerOk && <div className="wc-note is-warn" role="status"><WifiOff size={15} aria-hidden="true" /><span>{t('服务暂时不可用，请稍后再试。')}</span><button type="button" className="wc-btn is-sm" onClick={reload}>{t('重试')}</button></div>}

      {/* 我的小精灵 */}
      <section className="wc-panel" aria-labelledby="wc-mine-t">
        <div className="wc-ph">
          <h2 id="wc-mine-t" className="wc-ph-t">{t('我的小精灵')}{cards && (cards.cards.length > 0 || (mine?.length ?? 0) > 0) && <small className="num">{t('Zalien {n} 张 · 小精灵 {live} / {max} 只', { n: cards.cards.length, live: cards.liveFlies, max: cards.maxFlies })}</small>}</h2>
          {connected && status === 'ready' && <div className="wc-ph-act"><button type="button" className="wc-btn is-ghost is-sm" onClick={() => setLinking(true)}><Link2 size={13} />{t('关联其他钱包')}</button></div>}
        </div>
        {!connected ? (
          <Empty row icon={Wallet} text={t('连接 0x4 Wallet 后查看你的 Zalien 和小精灵，持有 Zalien 即可领养。')} action={<button type="button" className="wc-btn is-primary is-sm" onClick={() => { needWallet() }}>{t('连接 0x4 Wallet')}</button>} />
        ) : status !== 'ready' ? (
          // 社区没登录上：登录中转圈，失败说原因 +「重新登录」（这一页只在这里说）
          <SocialLogin />
        ) : mineErr ? (
          <Empty row icon={WifiOff} text={t('暂时无法读取你的小精灵。')} action={<button type="button" className="wc-btn is-sm" onClick={reload}><RefreshCw size={13} />{t('重试')}</button>} />
        ) : mine === undefined ? (
          <div className="wc-hrow" aria-label={t('正在读取…')}>{Array.from({ length: 4 }, (_, i) => <span key={i} className="wc-sk" style={{ height: 84, borderRadius: 12 }} />)}</div>
        ) : (
          <MineRow mine={mine} cards={cards} cardsErr={cardsErr} grant={grant} price={cap?.plans.basic.price} lives={lifeText} onClaim={setClaim} onGrant={() => setCreating(true)} onLink={() => setLinking(true)} onRetry={reload} />
        )}
      </section>

      {/* 此刻的伊甸园 */}
      <section className="wc-sec" aria-labelledby="wc-wall-t">
        <div className="wc-sec-h">
          <h2 id="wc-wall-t" className="wc-sec-t">{t('此刻的伊甸园')}{list && all.length > 0 && <small className="num">{t('共 {n} 只 · {m} 只在线', { n: all.length, m: online })}</small>}</h2>
          {/* 顶部「排行」页里的小精灵榜，直接滚到那一块（2026-09-30 goat：原来叫「小精灵排行」，看着像另一套排行） */}
          <Link to="/rank?focus=sprites" className="wc-link">{t('查看排行')}<ArrowRight size={13} /></Link>
        </div>
        {loadErr && !list ? <div className="wc-panel"><Empty row tall icon={WifiOff} text={t('暂时无法加载小精灵')} action={<button type="button" className="wc-btn is-sm" onClick={reload}><RefreshCw size={13} />{t('重试')}</button>} /></div>
          : !list ? <div className="wc-wall" aria-label={t('加载中…')}>{Array.from({ length: 8 }, (_, i) => <span key={i} className="wc-sk" style={{ height: 300, borderRadius: 14 }} />)}</div>
            : !all.length ? <div className="wc-panel"><Empty row tall icon={Sparkles} text={t('伊甸园里还没有小精灵')} /></div>
              : <div className="wc-wall">{wall.map((f) => <SpriteCard key={f.id} f={f} life={lives[f.id]} onOpen={() => open(f)} />)}</div>}
      </section>

      <FlySheet open={creating} onClose={() => setCreating(false)} onSaved={(f) => { setCreating(false); reload(); nav(`/fly/${f.id}?tab=trade&start=1`) }} plans={cap?.plans} remaining={cap?.remaining} grant={grant} />
      <FlySheet open={!!claim} onClose={() => setClaim(null)} onSaved={(f) => { setClaim(null); reload(); nav(`/fly/${f.id}?tab=trade&start=1`) }} plans={cap?.plans} remaining={cap?.remaining} card={claim} cards={cards?.cards} />
      <WalletLinkSheet open={linking} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); reload() }} />
    </div>
  )
}

/** 收起时最多显示几张（宽屏一行 4 张 = 两行） */
const COLLAPSED = 8

/** 我的小精灵：卡片网格（默认显示两行 = 8 张，多的「展开全部」）。领养规则和手机 MyZaliens 一致（手机端 / 没开余额功能时不出现价格和付费入口） */
function MineRow({ mine, cards, cardsErr, grant, price, lives, onClaim, onGrant, onLink, onRetry }: {
  mine: Fly[]; cards: ZalienCards | null; cardsErr: string | null; grant: Grant; price?: number; lives: Record<string, string>
  onClaim: (c: { tokenId: number; free: boolean }) => void; onGrant: () => void; onLink: () => void; onRetry: () => void
}) {
  // 排序：自己的小精灵在跑的卡 → 可以免费领养的 → 其它（被别人领养的、免费月用过的）
  const rank = (c: ZalienCard) => c.status === 'busy' && c.fly?.mine ? 0 : c.status === 'free' ? 1 : 2
  const list = [...(cards?.cards || [])].sort((a, b) => rank(a) - rank(b) || a.tokenId - b.tokenId)
  const full = !!cards && cards.liveFlies >= cards.maxFlies
  const [expanded, setExpanded] = useState(false)
  const byId = new Map(mine.map((f) => [f.id, f]))
  // 不挂在「我钱包里的卡」上的小精灵：赠送领的、老的、卡已经卖掉还在跑到期的
  const shown = new Set(list.filter((c) => c.fly?.mine).map((c) => c.fly!.id))
  const others = mine.filter((f) => !shown.has(f.id))
  const empty = !!cards && !list.length && !mine.length
  // 卡还没读到（也没读失败）：先占位
  if (!cards && !cardsErr) return <div className="wc-hrow">{Array.from({ length: 4 }, (_, i) => <span key={i} className="wc-sk" style={{ height: 84, borderRadius: 12 }} />)}</div>
  if (empty && !grant) {
    return (
      <div className="wc-mine-empty">
        <span className="wc-zc-ic" aria-hidden="true"><Sparkles size={22} strokeWidth={1.7} /></span>
        {/* 2026-09-27 goat 定稿文案，别改 */}
        <div><b>{t('想要领养小精灵？')}</b><p>{t('当前地址中未检测到持有Zalien.')}</p><p className="wc-key">Zalien is the key.</p></div>
        <button type="button" className="wc-btn" onClick={onLink}><Link2 size={14} />{t('关联其他钱包')}</button>
      </div>
    )
  }
  return (
    <>
      {cardsErr && <div className="wc-note is-warn" style={{ margin: '16px 20px 0' }} role="status"><WifiOff size={15} aria-hidden="true" /><span>{cardsErr}</span><button type="button" className="wc-btn is-sm" onClick={onRetry}>{t('重试')}</button></div>}
      <div className="wc-hrow">
        {grant && (
          <div className="wc-zc">
            <span className="wc-zc-ic" aria-hidden="true"><Gift size={22} strokeWidth={1.7} /></span>
            <span className="wc-zc-main"><b>{t('你有一只赠送的小精灵')}</b><small>{grant.note || t('免费领养，不用 Zalien')}</small>
              <button type="button" className="wc-btn is-primary is-sm" style={{ marginTop: 8 }} disabled={full} onClick={onGrant}><Plus size={13} />{full ? t('已达上限') : t('免费领养')}</button></span>
          </div>
        )}
        {list.slice(0, expanded ? list.length : Math.max(0, COLLAPSED - (grant ? 1 : 0))).map((c) => <CardTile key={c.tokenId} c={c} fly={c.fly ? byId.get(c.fly.id) : undefined} life={c.fly ? lives[c.fly.id] : undefined} full={full} price={price} onClaim={onClaim} />)}
        {(expanded || list.length + (grant ? 1 : 0) <= COLLAPSED) && others.map((f) => (
          <Link key={f.id} to={`/fly/${f.id}/live`} className="wc-zc">
            <Avatar address={f.address} name={f.name} size={56} />
            <span className="wc-zc-main"><b>{f.name}</b><small>{lives[f.id] || f.params.tokens.map((x) => x.symbol).join(' / ')}</small><FlyState f={f} /></span>
          </Link>
        ))}
      </div>
      {list.length + others.length + (grant ? 1 : 0) > COLLAPSED && (
        <div className="wc-more">
          <button type="button" className="wc-btn is-ghost is-sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? t('收起') : t('展开全部 {n} 项', { n: list.length + others.length + (grant ? 1 : 0) })}
          </button>
        </div>
      )}
      {list.length > 0 && <div className="wc-pf"><span className="flex items-center gap-2"><Info size={13} aria-hidden="true" />{t('每张 NFT 同一时间可领养一只小精灵。NFT 转让后，已领养的小精灵将运行至到期日，届时不可续期。')}</span></div>}
    </>
  )
}

/** 小精灵状态小标签 */
function FlyState({ f }: { f: Fly }) {
  if (f.expired) return <span className="wc-chip is-warn">{t('休眠中')}</span>
  if (f.halted) return <span className="wc-chip is-down">{t('停机')}</span>
  if (f.paused) return <span className="wc-chip">{t('已暂停')}</span>
  if (!f.activated) return <span className="wc-chip">{t('尚未启用')}</span>
  return <span className="wc-chip is-up">{t('运行中')}</span>
}

/** 一张 Zalien 卡：四种状态和手机 CardRow 一样（自己的小精灵在跑 / 被别人领养 / 可免费领养 / 免费月用过） */
function CardTile({ c, fly, life, full, price, onClaim }: { c: ZalienCard; fly?: Fly; life?: string; full: boolean; price?: number; onClaim: (c: { tokenId: number; free: boolean }) => void }) {
  const img = <img src={c.image} alt="" className="wc-zc-img" loading="lazy" />
  const title = <b>Zalien #{c.tokenId}</b>
  if (c.status === 'busy' && c.fly?.mine) {
    const sleeping = !!c.fly.paidUntil && c.fly.paidUntil <= Date.now()
    return (
      <Link to={`/fly/${c.fly.id}/live`} className="wc-zc">
        {img}
        <span className="wc-zc-main">{title}<small>{t('小精灵「{name}」', { name: c.fly.name })}{life ? ` · ${life}` : fly ? ` · ${fly.params.tokens.map((x) => x.symbol).join(' / ')}` : ''}</small>
          {sleeping ? <span className="wc-chip is-warn">{t('休眠中')}</span> : fly && !fly.activated ? <span className="wc-chip">{t('尚未启用')}</span> : <span className="wc-chip is-up">{t('运行中')}</span>}</span>
      </Link>
    )
  }
  if (c.status === 'busy') {
    const sleeping = !!c.fly?.paidUntil && c.fly.paidUntil <= Date.now()
    return (
      <div className="wc-zc">{img}<span className="wc-zc-main">{title}
        <small>{sleeping && c.fly?.releaseAt ? t('此卡已被领养，{date} 后可重新领养', { date: day(c.fly.releaseAt) }) : c.fly?.paidUntil ? t('此卡已被领养，{date} 到期', { date: day(c.fly.paidUntil) }) : t('此卡已被领养')}</small>
        <span className="wc-chip is-warn">{t('已被领养')}</span></span></div>
    )
  }
  if (c.status === 'free') {
    return (
      <div className="wc-zc">{img}<span className="wc-zc-main">{title}<small>{t('可免费领养 1 个月')}</small>
        <button type="button" className="wc-btn is-primary is-sm" style={{ marginTop: 8 }} disabled={full} onClick={() => onClaim({ tokenId: c.tokenId, free: true })}>{full ? t('已达上限') : t('免费领养')}</button></span></div>
    )
  }
  // 未领养（免费月已用）：没开余额功能时只写状态，不写价格也不给付费入口
  return (
    <div className="wc-zc">{img}<span className="wc-zc-main">{title}<small>{t('此卡当前未被领养')}</small>
      {!BALANCE_FEATURES ? <span className="wc-chip">{t('未领养')}</span>
        : <button type="button" className="wc-btn is-sm" style={{ marginTop: 8 }} disabled={full} onClick={() => onClaim({ tokenId: c.tokenId, free: false })}>{t('领养 · {price}/月', { price: fmtUsd(price ?? 10) })}</button>}</span></div>
  )
}

/** 盈亏：没启用 / 主人隐藏 / 还没数据分别说明，不显示成 0 */
function PnlCell({ f }: { f: Fly }) {
  if (!f.activated) return <span>{t('尚未启用')}</span>
  if (f.pnlHidden) return <span>{t('盈亏已隐藏')}</span>
  if (f.pnl == null) return <span>{t('等数据')}</span>
  return <b className={`num ${f.pnl > 0 ? 'wc-up' : f.pnl < 0 ? 'wc-down' : ''}`}>{pnlText(f.pnl)}</b>
}

/** 一张小精灵卡（统一高度）：楼层、在线状态、此刻在做什么、最近一次真实决策、关注的币、模式和盈亏 */
function SpriteCard({ f, life, onOpen }: { f: Fly; life?: LifeRow; onOpen: () => void }) {
  const en = locale() === 'en-US'
  const d = life?.decision
  const on = f.online && !f.expired
  const state = f.expired ? t('休眠') : f.paused ? t('已暂停') : f.halted ? t('停机') : f.online ? t('在线') : t('离线')
  // 还没选模式（pending）的左边留空，右边盈亏格会写「尚未启用」，不重复说
  const mode = f.mode === 'perp' ? t('合约 {n}x', { n: f.leverage }) : f.mode === 'confirm' ? t('真金') : ''
  return (
    <button type="button" className="wc-panel wc-sprite" onClick={onOpen}>
      <span className="wc-sprite-top">
        {life ? <span className="wc-chip"><MapPin size={11} aria-hidden="true" />{floorName(life.life.floor)}</span> : <span />}
        <span className={`flex items-center gap-1.5 text-[12px] ${on ? 'wc-up' : 'wc-mute'}`}><span className={`wc-dot ${on ? 'is-on' : ''}`} aria-hidden="true" />{state}</span>
      </span>
      <span className="wc-sprite-id">
        <Avatar address={f.address} name={f.name} size={44} />
        <span className="wc-grow"><b>{f.name}</b><small>{t('{owner} 的小精灵', { owner: f.ownerNickname || `${f.owner.slice(0, 6)}…` })}</small></span>
      </span>
      <span className="wc-sprite-life">{life ? (en ? life.life.textEn : life.life.text) : <span className="wc-faint">{t('暂时读不到它在做什么')}</span>}</span>
      <span className="wc-sprite-brain">
        <span><Brain size={13} aria-hidden="true" />{d ? <>{t('最近一次判断')}<b className={d.side === 'BUY' ? 'wc-up' : d.side === 'SELL' ? 'wc-down' : ''}>{d.side ?? '--'}{d.symbol ? ` ${d.symbol}` : ''}</b><span className="wc-faint">{timeAgo(d.ts)}</span></> : t('还没有做过判断')}</span>
        <span className="wc-faint">{d?.spikes != null ? t('神经元放电 {n} 次', { n: fmtAmount(d.spikes, 0) }) : ' '}</span>
      </span>
      <span className="wc-sprite-tokens">{f.params.tokens.slice(0, 5).map((tk) => <span key={`${tk.chain}:${tk.address}`} className="wc-chip">{tk.symbol}</span>)}</span>
      <span className="wc-sprite-foot">
        <span className="wc-ell">{mode}{f.mode === 'perp' && f.realEquity != null ? ` · ${t('账户 {amount}', { amount: fmtUsd(f.realEquity) })}` : ''}</span>
        <PnlCell f={f} />
      </span>
    </button>
  )
}
