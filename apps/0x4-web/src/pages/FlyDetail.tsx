// Fly home: realtime neural activity, decisions, dopamine, equity curve, the candles as it sees them, fills and copy-trading
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock, RotateCcw } from 'lucide-react'
import { ADOPT_IN_APP, PERP_ENABLED } from '@/lib/features'
import RealModeSheet from '@/components/RealModeSheet'
import FlyPerpPositions from '@/components/FlyPerpPositions'
import { displaySymbol, rejectWhy } from '@/lib/flyText'
import Button from '@/components/Button'
import FlyTradeSettings from '@/components/FlyTradeSettings'
import Avatar from '@/components/Avatar'
import FollowButton from '@/components/FollowButton'
import FlySheet, { DEFAULT_FLY_TOKENS } from '@/components/FlySheet'
import NeuronCloud, { type NeuronCloudHandle } from '@/components/NeuronCloud'
import { toast } from '@/components/Toast'
import { api, SOCIAL_API, type Fly, type FlyPlan, type FlyProposal } from '@/lib/social'
import { TopupSheet, useGiftWallet } from '@/components/GiftSheet'
import { fmtUsd, timeAgo } from '@/lib/format'
import { useSocial } from '@/store/social'
import { pnlText } from './Flies'
import { WatchPanel } from './FlyWatch'
import { BALANCE_FEATURES } from '@/lib/features'
import { locale, t, useLang } from '@/lib/i18n'
import FlyHolds from '@/components/FlyHolds'
import FlyAsks from '@/components/FlyAsks'
import AutoTradeSheet from '@/components/AutoTradeSheet'
import SolAutoTradeSheet from '@/components/SolAutoTradeSheet'
import { solAutoConfig, solAutoStatus } from '@/lib/solAuto'
import { watchesChain } from '@/lib/flyChains'
import { autoConfig, autoStatus } from '@/lib/autoTrade'
import HolderBadge from '@/components/HolderBadge'
import TokenLogo from '@/components/TokenLogo'
import { tokenLogo } from '@/lib/chains'
import { errorText } from '@/lib/errors'

interface Trade { id: string; side: 'buy' | 'sell'; chain: string; token: string; symbol: string; qty: number; usd: number; price: number; created_at: number; realized: number }

/** The three perp-pause reasons (verbatim from the trading process's PAUSE_REASONS): under maintenance / authorization failed verification / verifying. Anything else displays as under maintenance */
// Pause / not-permitted reasons sent back by the worker (worker.py's PAUSE_REASONS, PERMIT_REASONS): known ones shown verbatim, unknown ones treated as maintenance
const PAUSE_TEXT = ['合约自动下单暂停维护中，只记录信号不下单', '合约授权没有通过核对，请在「交易方式」里重新授权，现在只记录信号不下单', '正在核对合约授权，核对完成前只记录信号不下单',
  '小精灵已经不在合约模式，这一单没有下', '小精灵已暂停，这一单没有下', '小精灵已到期，这一单没有下', '服务器没有放行这一单，没有下单', '暂时无法向服务器确认能否下单，这一轮不下单']

/** Full-auto currently only works on BNB Chain: the prompt to enable full-auto appears only when the sprite watches coins on (or auto-finds coins on) chains including BNB Chain; coins only on Solana etc. stay per-trade confirm as usual */
const watchesBsc = (f: Fly) => (f.params.autoPick ? f.params.autoPick.chains.includes('bsc') : f.params.tokens.some((x) => x.chain === 'bsc'))

/**
 * "You missed N trade requests while away" (2026-10-04 goat: a user adopted one, left, and all 23 requests expired overnight). In spot per-trade-confirm mode, say so at the top of the sprite page on return.
 * Full-auto available but the owner hasn't enabled it: ask "Switch to full-auto trading?" —
 *   watching BNB Chain coins → open the BNB Chain full-auto panel; watching Solana coins → open the Solana full-auto panel (2026-10-04 Solana edition);
 *   only other chains (Ethereum, Base, etc.; or only SOL while Solana full-auto isn't available yet) → first offer to switch to BNB, then open the BNB Chain panel after switching.
 * Full-auto unavailable, already enabled, or auto-pick selected but none of the picked chains support it: only say how many were missed. Tapping any button counts as seen (the server records the time; afterwards only newly missed ones are counted)
 */
type AutoTarget = 'bsc' | 'sol' | 'switch'
function MissedAsks({ fly, onAuto, onSeen, onChanged }: { fly: Fly; onAuto: (target: 'bsc' | 'sol') => void; onSeen: () => void; onChanged: (f: Fly) => void }) {
  const n = fly.missedAsks || 0
  const bsc = watchesChain(fly, 'bsc'), sol = watchesChain(fly, 'solana')
  // Only watching other chains (including only SOL while Solana full-auto isn't available yet): can switch to BNB for BNB Chain full-auto
  const switchable = !bsc && !fly.params.autoPick
  const [target, setTarget] = useState<AutoTarget | null | undefined>(undefined)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!n) return
    let alive = true
    const evm = async () => { const [cfg, st] = await Promise.all([autoConfig(), autoStatus()]); return cfg.enabled && !st.active && st.eligible !== false }
    const solana = async () => { const [cfg, st] = await Promise.all([solAutoConfig(), solAutoStatus()]); return cfg.enabled && !st.active }
    ;(async () => {
      if (bsc && await evm().catch(() => false)) return 'bsc' as const
      if (sol && await solana().catch(() => false)) return 'sol' as const
      if (switchable && await evm().catch(() => false)) return 'switch' as const
      return null
    })().then((x) => { if (alive) setTarget(x) })
    return () => { alive = false }
  }, [fly.id, n, bsc, sol, switchable])
  if (!n || target === undefined) return null
  const seen = () => { void api(`/api/flies/${fly.id}/missed-seen`, { method: 'POST' }).catch(() => {}); onSeen() }
  const toBnb = async () => {
    setBusy(true)
    try {
      const f = await api<Fly>(`/api/flies/${fly.id}`, { method: 'PUT', body: JSON.stringify({ params: { tokens: DEFAULT_FLY_TOKENS, autoPick: null } }) })
      onChanged(f); seen(); onAuto('bsc')
    } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setBusy(false) }
  }
  const symbols = fly.params.tokens.map((x) => x.symbol).join('、')
  return (
    <div role="status" className="mt-3 flex items-start gap-3 rounded-2xl bg-card p-3" data-testid="fly-missed">
      <Clock size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {asking
          ? <p className="text-sm">{t('全自动只支持 BNB Chain 上的币。把 {name} 关注的 {symbols} 换成 BNB？', { name: fly.name, symbols })}</p>
          : <p className="text-sm">{target ? t('你不在时错过了 {n} 次交易申请，设置为全自动交易？', { n }) : t('你不在时错过了 {n} 次交易申请', { n })}</p>}
        <div className="mt-2 flex gap-2">
          {asking
            ? <><Button size="sm" loading={busy} onClick={() => void toBnb()}>{t('换成 BNB')}</Button><Button size="sm" variant="ghost" className="text-muted" disabled={busy} onClick={() => setAsking(false)}>{t('取消')}</Button></>
            : <>
              {target && <Button size="sm" onClick={() => { if (target === 'switch') setAsking(true); else { seen(); onAuto(target) } }}>{t('设置')}</Button>}
              <Button size="sm" variant="ghost" className="text-muted" onClick={seen}>{target ? t('不用了') : t('知道了')}</Button>
            </>}
        </div>
      </div>
    </div>
  )
}

/** The worker's downtime reasons are in English — translate into words users understand */
function haltText(h: string): string {
  if (/insufficient|balance/i.test(h)) return t('账户余额不足')
  if (/drawdown|loss/i.test(h)) return t('触发了回撤保护')
  if (/equity unavailable|network|timeout/i.test(h)) return t('暂时读不到账户数据')
  return t('遇到问题')
}

export default function FlyDetail() {
  const lang = useLang((s) => s.lang)
  const { id = '' } = useParams()
  // Tabs: ?tab=now|trade|risk|data; legacy ?s=settings links land on the "trade" tab
  const [search] = useSearchParams()
  type Tab = 'now' | 'trade' | 'risk' | 'data'
  const initial = (search.get('tab') as Tab | null) || (search.get('s') === 'settings' ? 'trade' : 'now')
  const [tab, setTab] = useState<Tab>(['now', 'trade', 'risk', 'data'].includes(initial) ? initial : 'now')
  const nav = useNavigate()
  // "Is the owner" is decided by the logged-in 0x4 account (the account the server knows), not the wallet address:
  // Desktop web logs in with the 0x address; the account may be a Solana account that proved this 0x, not necessarily the extension's own Solana address (2026-09-30)
  const meAddr = useSocial((s) => s.me?.address)
  const address = meAddr ?? null
  const live = useSocial((s) => s.flyTicks[id])
  const [fly, setFly] = useState<Fly | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  const [trades, setTrades] = useState<Trade[]>([])
  const [editing, setEditing] = useState(false)
  const [topup, setTopup] = useState(false)
  const [realOpen, setRealOpen] = useState(false)
  // Start trading (2026-10-05 goat: "starting trading is too complicated"): the trade-mode panel's "spot trading" page is just one amount and one button; arriving after adoption with ?start=1 pops it directly
  const autoStarted = useRef(false)
  const [realEnabled, setRealEnabled] = useState(false)
  // Spot mode defaults to full-auto (2026-09-28 goat: spot should be full-auto too): after picking spot mode, if full-auto isn't enabled yet and the server has it available,
  // open the "full-auto trading" panel next for a one-time authorization. When the contract isn't deployed yet, /api/auto/config returns enabled=false — nothing pops, per-trade confirm as usual
  const [autoOpen, setAutoOpen] = useState(false)
  const [solOpen, setSolOpen] = useState(false)
  const [autoKey, setAutoKey] = useState(0)
  const offerAuto = async () => {
    try {
      const [cfg, st] = await Promise.all([autoConfig(), autoStatus()])
      if (cfg.enabled && !st.active && st.eligible !== false) window.setTimeout(() => setAutoOpen(true), 350)   // Wait for the trade-mode panel to close before popping — no two layers stacked
    } catch { /* If it can't be fetched, don't pop — "full-auto trading" in trade settings can still be enabled */ }
  }
  // Same for the Solana edition (2026-10-04): if the server has it available and it's not enabled, open the Solana full-auto panel next
  const offerSolAuto = async () => {
    try {
      const [cfg, st] = await Promise.all([solAutoConfig(), solAutoStatus()])
      if (cfg.enabled && !st.active) window.setTimeout(() => setSolOpen(true), 350)
    } catch { /* If it can't be fetched, don't pop — it can still be enabled in trade settings */ }
  }
  const [proposals, setProposals] = useState<FlyProposal[]>([])
  const liveProposals = useSocial((s) => s.flyProposals)
  useEffect(() => { api<{ realTradingEnabled: boolean }>('/api/flies').then((r) => setRealEnabled(r.realTradingEnabled)).catch(() => {}) }, [])
  useEffect(() => { if (fly && fly.owner === address && fly.mode === 'confirm') api<FlyProposal[]>('/api/fly/proposals').then((l) => setProposals(l.filter((p) => p.flyId === fly.id))).catch(() => {}) }, [fly?.id, fly?.mode, fly?.owner, address, liveProposals.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const { wallet, reload: reloadWallet } = useGiftWallet()
  const renew = async (plan?: FlyPlan) => { if (!fly) return; try { const r = await api<Fly & { balance: number }>(`/api/flies/${fly.id}/renew`, { method: 'POST', body: JSON.stringify({ plan }) }); setFly(r); reloadWallet(); toast.success(t('已续期 30 天')) } catch (e) { const m = errorText(e, t('续费失败')); if (m.includes('余额不足')) setTopup(true); else toast.error(m) } }
  const cloud = useRef<NeuronCloudHandle>(null)
  const lastTs = useRef(0)

  const load = () => api<Fly>(`/api/flies/${id}`).then((f) => { setFly(f); api<{ trades: Trade[] }>(`/api/users/${f.address}/trades`).then((r) => setTrades(r.trades)).catch(() => {}) }).catch(() => setLoadErr(true))
  // Fetch again after login is restored (2026-10-04: opening / refreshing this page directly, the page fired requests before login, the server treated it as a guest, and owner-only data — missed requests, PnL, positions — was missing)
  const signedIn = useSocial((s) => s.status === 'ready')
  useEffect(() => { load() }, [id, signedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoStarted.current || !fly || search.get('start') !== '1' || fly.mode !== 'pending' || fly.owner !== address || fly.expired || !realEnabled) return
    autoStarted.current = true; setRealOpen(true)
  }, [fly, address, realEnabled]) // eslint-disable-line react-hooks/exhaustive-deps
  // New tick arrived: fire per spike count; whole-brain pulse on fills or dopamine
  useEffect(() => {
    if (!live || live.ts === lastTs.current) return
    lastTs.current = live.ts
    setFly((f) => (f ? { ...f, tick: live.tick, equity: live.equity, ...(live.equitySource === 'hyperliquid-account' && live.accountEquity != null ? { realEquity: live.accountEquity, pnl: live.accountEquity - (f.realAnchor ?? live.accountEquity) } : {}), lastTickAt: live.ts, online: true, ticks: [...(f.ticks || []), live].slice(-200) } : f))
    cloud.current?.flash(Math.min(80, (live.neural.total_spikes ?? 0) / 600))
    if (live.neural.stimulus === 'reward') cloud.current?.pulse('200,255,77')
    else if (live.neural.stimulus === 'aversive') cloud.current?.pulse('255,80,80')
    if (live.execution === 'FILLED' || !fly?.frameUrl) load() // Re-fetch on fills or when no visual frame has arrived yet
  }, [live])
  // The activity overview only responds to new ticks: no auto-cycling of historical data, no placeholder values for missing spike counts.

  if (!fly) return <div className="p-8 text-center text-sm text-muted">{loadErr ? t('加载失败，稍后再试') : t('加载中…')}</div>
  const tk = fly.ticks?.length ? fly.ticks[fly.ticks.length - 1] : undefined
  const isOwner = fly.owner === address
  // Perp mode but the perp account has no money (or not enough for one margin): the sprite won't open positions without readable account funds. Tell new users where to deposit (2026-09-27 goat; copy shortened to one line on 09-28, no exchange brand names)
  const needFunds = PERP_ENABLED && isOwner && fly.mode === 'perp' && !fly.expired && (fly.realEquity == null || fly.realEquity < (fly.marginUsd || 10))
  const fundHint = (
    <div className="mt-4 rounded-2xl border border-accent/40 bg-accent/10 p-4">
      <div className="text-[15px] font-semibold">{t('合约账户还没有足够的资金')}</div>
      <Button className="mt-3 w-full" onClick={() => nav('/perp?fund=deposit')}>{t('去存入 USDT')}</Button>
    </div>
  )
  const autoWatching = !!fly.params.autoPick && fly.mode === 'confirm' && !!fly.autoTokens?.length
  const watching = autoWatching ? fly.autoTokens! : fly.params.tokens
  const tabList: [Tab, string][] = isOwner ? [['now', '现在'], ['trade', '交易||tab'], ['risk', '风控'], ['data', '数据']] : [['now', '现在'], ['data', '数据']]
  const setState = async (body: Record<string, unknown>) => { try { setFly(await api<Fly>(`/api/flies/${fly.id}`, { method: 'PUT', body: JSON.stringify(body) })) } catch (e) { toast.error(errorText(e, t('失败'))) } }
  const side = tk?.neural.side || 'HOLD'
  // The curve only draws real account equity (perp); confirm has no continuous equity — don't draw
  const curve = fly.mode === 'perp' ? (fly.ticks || []).filter((k) => k.accountEquity != null).map((k) => k.accountEquity as number) : []
  return (
    <div className="px-4 pb-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
      <div className="flex flex-wrap items-center gap-2"><button onClick={() => nav(-1)} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={22} /></button><h1 className="min-w-0 flex-1 break-all text-xl font-bold">{fly.name}</h1><span className={`ml-auto flex items-center gap-1 text-xs ${fly.online ? 'text-up' : 'text-muted'}`}><span className={`h-2 w-2 rounded-full ${fly.online ? 'bg-up' : 'bg-line'}`} />{fly.online ? t('在线') : fly.lastTickAt ? t('上次 {time}', { time: timeAgo(fly.lastTickAt) }) : t('未连接')}</span></div>
      {/* Next to the avatar (2026-09-28 goat): line 1 "ZALIEN #x's sprite" + Holder (only shown if the owner still holds this card); line 2 the coins it watches, as small icon tags;
          line 3 personality and learning. Follower count and observation interval no longer shown */}
      <div className="mt-3 flex items-center gap-3">
        <Avatar address={fly.address} name={fly.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold">{fly.nftToken && ADOPT_IN_APP ? t('ZALIEN #{id} 的小精灵', { id: fly.nftToken }) : t('{name} 的小精灵', { name: fly.ownerNickname || fly.owner.slice(0, 6) })}</span>
            {ADOPT_IN_APP && fly.nftToken != null && fly.nftHolder === true && <HolderBadge />}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label={t('它在看的币')}>
            {watching.map((c) => (
              <span key={c.chain + c.address} className="inline-flex items-center gap-1 rounded-full border border-line/70 bg-card2/70 py-0.5 pl-0.5 pr-2 text-[11px] font-semibold">
                <TokenLogo src={tokenLogo(c.chain, c.address)} symbol={c.symbol} chain={c.chain} address={c.address} size={16} />{c.symbol}
              </span>
            ))}
            {autoWatching && <span className="rounded-full border border-accent/40 px-1.5 py-px text-[10px] font-semibold text-accent">{t('自动选币')}</span>}
          </div>
          <div className="mt-1 text-[11px] text-muted">{t(fly.params.thresholdHz >= 3 ? '保守' : fly.params.thresholdHz >= 2 ? '均衡' : '激进')} · {fly.params.learning ? t('持续学习') : t('不学习')}</div>
        </div>
        <FollowButton address={fly.address} />
      </div>
      {isOwner && fly.mode === 'confirm' && !fly.expired && <MissedAsks fly={fly} onAuto={(x) => (x === 'sol' ? setSolOpen(true) : setAutoOpen(true))} onSeen={() => setFly((f) => (f ? { ...f, missedAsks: 0 } : f))} onChanged={(f) => setFly({ ...f, missedAsks: 0 })} />}
      {/* Tabs (2026-09-27 goat: settings shouldn't be one long page): Now / Trade / Risk / Data; other people's sprites only show Now / Data */}
      <div className="mt-3 flex rounded-xl border border-line/70 bg-card p-1" role="tablist" aria-label={t('小精灵详情')}>
        {tabList.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 flex-1 rounded-lg text-sm font-semibold transition-colors ${tab === k ? 'bg-card2 text-fg shadow-sm' : 'text-muted'}`}>{t(label)}</button>)}
      </div>
      {tab === 'now' && <>
        {needFunds && fundHint}
        {PERP_ENABLED && isOwner && fly.mode === 'perp' && <FlyAsks flyId={fly.id} />}
      {isOwner && fly.mode === 'confirm' && proposals.length > 0 && (
        <div className="mt-2 rounded-2xl bg-card p-3">
          <div className="mb-1 text-xs font-semibold text-muted">{t('待确认的交易建议')}</div>
          {proposals.map((p) => <div key={p.id} className="py-1 text-sm"><div className="flex items-center justify-between"><span>{t('{side} {symbol} · 约 ${usd}', { side: p.side === 'buy' ? t('买入') : t('卖出'), symbol: p.symbol, usd: p.usd })}</span><span className="text-xs text-muted">{t('{n} 分钟内', { n: Math.max(0, Math.round((p.expiresAt - Date.now()) / 60000)) })}</span></div>{p.say && <div className="mt-0.5 text-xs text-muted">“{lang === 'en' ? p.sayEn || p.say : p.say}”</div>}</div>)}
          <div className="text-[11px] text-muted">{t('交易建议将推送到你的手机，点击「确认下单」即可成交')}</div>
        </div>
      )}
        <WatchPanel id={fly.id} />
      </>}
      {tab === 'trade' && isOwner && <>
        {needFunds && fundHint}
        {/* The iOS listing build has no perps: sprites already in perp mode keep running as configured; here just explain and leave the two options "switch to spot / pause" */}
        {!PERP_ENABLED && fly.mode === 'perp' && <div className="mt-3 rounded-2xl border border-line/70 bg-card p-4 text-[13px] leading-relaxed text-muted">{t('这只小精灵当前的交易方式在此版本中不可用，它会按原来的设置继续运行。你可以在下面的「交易方式」里改为现货模式，或暂停它。')}</div>}
        {PERP_ENABLED && fly.mode === 'perp' && <FlyAsks flyId={fly.id} />}
        {/* Orders opened by the perp sprite: positions + recent fills (2026-10-05 goat: "nowhere to see the sprite's orders") */}
        {PERP_ENABLED && fly.mode === 'perp' && fly.activated && <FlyPerpPositions flyId={fly.id} tick={fly.lastTickAt} fills={trades} marginUsd={fly.marginUsd || 10} />}
        {fly.mode !== 'perp' && <FlyHolds flyId={fly.id} holdStyle={fly.prefs?.holdStyle} />}
      {!fly.activated ? (
        <div className="mt-3 flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-sm"><div className="font-semibold">{t('还没开始交易')}</div>
          {/* 2026-10-05 goat: the full-width big button was too large, changed to a regular button right of the title */}
          {isOwner && !fly.expired && <Button size="sm" className="shrink-0 px-5" onClick={() => (realEnabled ? setRealOpen(true) : toast.error(t('真实交易功能暂未开放。')))}>{t('开始交易')}</Button>}
        </div>
      ) : fly.mode === 'perp' ? (
        <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-line min-[400px]:grid-cols-3">
          <div className="min-w-0 bg-card p-3 [&>div:last-child]:break-all [&>div:last-child]:tabular-nums"><div className="text-[11px] text-muted">{t('账户权益')}</div><div className="font-bold">{fly.realEquity != null ? fmtUsd(fly.realEquity) : '--'}</div></div>
          <div className="min-w-0 bg-card p-3 [&>div:last-child]:break-all [&>div:last-child]:tabular-nums"><div className="text-[11px] text-muted">{t('激活后账户变化')}</div><div className={`font-bold ${(fly.pnl ?? 0) > 0 ? 'text-up' : (fly.pnl ?? 0) < 0 ? 'text-down' : ''}`}>{fly.pnl == null ? '--' : pnlText(fly.pnl)}</div></div>
          <div className="min-w-0 bg-card p-3 [&>div:last-child]:break-all [&>div:last-child]:tabular-nums"><div className="text-[11px] text-muted">{t('激活时权益')}</div><div className="font-bold">{fly.realAnchor != null ? fmtUsd(fly.realAnchor) : '--'}</div></div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-line min-[400px]:grid-cols-3">
          <div className="min-w-0 bg-card p-3 [&>div:last-child]:break-all [&>div:last-child]:tabular-nums"><div className="text-[11px] text-muted">{t('已确认成交')}</div><div className="font-bold">{fly.realizedTrades == null ? '--' : t('{n} 笔', { n: fly.realizedTrades })}</div></div>
          <div className="min-w-0 bg-card p-3 [&>div:last-child]:break-all [&>div:last-child]:tabular-nums"><div className="text-[11px] text-muted">{t('已实现盈亏')}</div><div className={`font-bold ${(fly.pnl ?? 0) > 0 ? 'text-up' : (fly.pnl ?? 0) < 0 ? 'text-down' : ''}`}>{fly.pnl == null ? '--' : pnlText(fly.pnl)}</div></div>
          <div className="min-w-0 bg-card p-3 [&>div:last-child]:break-all [&>div:last-child]:tabular-nums"><div className="text-[11px] text-muted">{t('成交额')}</div><div className="font-bold">{fly.turnover == null ? '--' : fmtUsd(fly.turnover)}</div></div>
        </div>
      )}
      {fly.halted && <div className="mt-2 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{fly.halted.includes('reconciliation required') ? t('已暂停：有一笔订单结果待核对，系统正在自动与交易所对账，完成后自动恢复。') : t('已暂停：{reason}。重置后可以重新开始。', { reason: haltText(fly.halted) })}</div>}
      {/* Adoption term. The mobile app only shows the date, no price or renew entry (Apple review); renewal on web / desktop */}
      {fly.paidUntil && <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ${fly.expired ? 'bg-warning/10 text-warning' : 'bg-card text-muted'}`}><span>{fly.expired ? (fly.releaseAt ? t('休眠中：领养已于 {date} 到期，{release} 后领养结束', { date: new Date(fly.paidUntil).toLocaleDateString(locale()), release: new Date(fly.releaseAt).toLocaleDateString(locale()) }) : t('休眠中：领养已于 {date} 到期', { date: new Date(fly.paidUntil).toLocaleDateString(locale()) })) : t('领养到期日 {date}（剩余 {n} 天）', { date: new Date(fly.paidUntil).toLocaleDateString(locale()), n: Math.max(0, Math.ceil((fly.paidUntil - Date.now()) / 86400000)) })}</span>{isOwner && BALANCE_FEATURES && <button onClick={() => renew()} className="font-semibold text-accent">{t('续期 30 天')}</button>}</div>}

      {/* The trade-mode banner was removed (2026-10-05 goat: "fewer words" — the "trade mode" row below already states leverage and margin) */}
      {isOwner && !realEnabled && !fly.activated && <div className="mt-3 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{t('真实交易功能暂未开放。')}</div>}
      {isOwner && <FlyTradeSettings part="trade" autoKey={autoKey} fly={fly} onChanged={setFly} onOpenMode={() => (realEnabled || fly.activated ? setRealOpen(true) : toast.error(t('真实交易功能暂未开放。')))} onOpenParams={() => setEditing(true)} />}
      {isOwner && <div className="mt-2 flex justify-end"><button className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => confirm(t('确定清空交易记录与学习状态并重新开始吗？')) && setState({ reset: true, paused: false })}><RotateCcw size={12} className="mr-1 inline-block align-[-2px]" />{t('重置记录')}</button></div>}
      </>}
      {tab === 'risk' && isOwner && <>
      {isOwner && <FlyTradeSettings part="risk" fly={fly} onChanged={setFly} onOpenMode={() => (realEnabled || fly.activated ? setRealOpen(true) : toast.error(t('真实交易功能暂未开放。')))} onOpenParams={() => setEditing(true)} />}
      </>}
      {tab === 'data' && <>
      {/* Decisions and stats are laid out independently, not overlaid on the image; the overview map doesn't correspond to real neuron spatial positions. */}
      <section className="mt-4 overflow-hidden rounded-xl border border-line bg-card" aria-label={t('最近神经活动')}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div><div className="text-xs text-muted">{t('最近决策')}</div><div className={`mt-1 break-all text-xl font-semibold ${side === 'BUY' ? 'text-up' : side === 'SELL' ? 'text-down' : ''}`}>{!tk?.neural.side ? '--' : side === 'BUY' ? t('买') + ' ' : side === 'SELL' ? t('卖') + ' ' : t('持有') + ' '}{displaySymbol(tk?.symbol)}</div></div>
          <div className="text-right text-xs text-muted"><div>{tk?.execution === 'FILLED' ? t('已成交') : tk?.execution === 'REJECTED' ? t('没下成') : tk?.execution === 'VETO' ? t('已被风控拦截') : tk?.execution === 'UNFUNDED' ? t('未入金，只记录信号') : tk?.execution === 'PAUSED' ? t(PAUSE_TEXT.includes(tk.executionReason || '') ? tk.executionReason! : '合约自动下单暂停维护中，只记录信号') : tk?.execution === 'ASK' ? t('等待你确认') : tk ? t('观望') : t('尚未开始')}</div>{tk && <div className="mt-1">{timeAgo(tk.ts)}</div>}</div>
        </div>
        {/* The exchange's order-rejection reason (previously shown as "standing by", 2026-10-05 goat) */}
        {tk?.execution === 'REJECTED' && <p className="mx-4 mb-3 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{rejectWhy(tk.executionReason, fly.marginUsd || 10)}</p>}
        <div className="relative overflow-hidden border-t border-line bg-black">
          <NeuronCloud ref={cloud} />
          <div className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] text-white/70">{t('神经活动示意图')}{fly.paused ? ` · ${t('已暂停')}` : !fly.online ? ` · ${t('历史活动')}` : ` · ${t('实时更新')}`}</div>
        </div>
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{t('神经活动详情')}</summary>
          <div className="px-4 pb-4">
            <p className="text-xs leading-relaxed text-muted">{t('示意图仅供参考，下方数据来自最近一次观察。')}</p>
            <div className="mt-2 text-xs text-muted">{fly.paused ? t('已暂停') : !fly.online ? t('历史活动') : t('等待更新')}</div>
            <dl className="grid grid-cols-2 gap-3 text-xs text-muted">
              <div><dt>{t('放电次数')}</dt><dd className="mt-1 text-sm text-fg tabular-nums">{tk?.neural.total_spikes?.toLocaleString() ?? '--'}</dd></div>
              <div><dt>{t('观察次数')}</dt><dd className="mt-1 text-sm text-fg tabular-nums">{fly.tick ?? '--'}</dd></div>
              <div><dt>{t('左 / 右决策信号')}</dt><dd className="mt-1 text-sm text-fg tabular-nums">{tk?.neural.left_hz?.toFixed(1) ?? '--'}/{tk?.neural.right_hz?.toFixed(1) ?? '--'}</dd></div>
              <div><dt>{t('学习调整次数')}</dt><dd className="mt-1 text-sm text-fg tabular-nums">{tk?.changedEdges ?? '--'}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
              <span>{t('学习信号')} {tk?.neural.stimulus === 'reward' ? <span className="text-up">● {t('正向')}</span> : tk?.neural.stimulus === 'aversive' ? <span className="text-down">● {t('负向')}</span> : tk?.neural.stimulus ? `○ ${t('无')}` : '--'}</span>
              <span>{t('决策门控 {n} 次', { n: tk?.neural.gate_spikes ?? '--' })}</span>
            </div>
          </div>
        </details>
      </section>
      {curve.length > 1 && <div className="mt-3"><div className="mb-2 text-xs font-semibold text-muted">{t('账户权益变化')}</div><Curve values={curve} /></div>}
      {fly.frameUrl && <div className="mt-4"><div className="mb-1 text-xs font-semibold text-muted">{t('它眼中的市场')}</div><img src={SOCIAL_API + fly.frameUrl} alt={t('最近一次小精灵观察的市场图像')} className="w-full rounded-xl border border-line" /></div>}
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">{t('成交')}</h2></div>
        {trades.slice(0, 20).map((x) => (
          <div key={x.id} className="flex items-center gap-3 border-b border-line py-2.5 text-sm">
            <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${x.side === 'buy' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{x.side === 'buy' ? t('买入') : t('卖出')}</span>
            <div className="min-w-0 flex-1"><div className="font-semibold">{displaySymbol(x.symbol)}{x.chain === 'hyperliquid' && <span className="ml-1.5 rounded bg-card2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{t('合约')}</span>} <span className="text-xs font-normal text-muted">{fmtUsd(x.usd)}</span></div><div className="text-[11px] text-muted">{timeAgo(x.created_at)}{x.side === 'sell' && x.realized ? ` · ${t('已实现 {pnl}', { pnl: pnlText(x.realized) })}` : ''}</div></div>
            {/* Perp fills (the stored chain name hyperliquid is a historical leftover, see CLAUDE.md) copy-trade to the perp page; previously linked to an unopenable coin detail */}
            <Link to={x.chain === 'hyperliquid' ? `/perp?coin=${encodeURIComponent(displaySymbol(x.symbol))}` : `/token/${x.chain}/${x.token}`} className="rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-bg">{t('跟单')}</Link>
          </div>
        ))}
        {!trades.length && <div className="py-6 text-center text-xs text-muted">{t('暂无成交记录。')}</div>}
      </section>
      <p className="mt-6 text-[11px] leading-relaxed text-muted">{t('不保证盈利，不构成投资建议。')}</p>
      </>}
      <FlySheet open={editing} onClose={() => setEditing(false)} fly={fly} onSaved={(f) => { setEditing(false); setFly(f) }} />
      <TopupSheet open={topup} onClose={() => { setTopup(false); reloadWallet() }} wallet={wallet} />
      <RealModeSheet open={realOpen} onClose={() => setRealOpen(false)} fly={fly} onAutoSheet={() => window.setTimeout(() => setAutoOpen(true), 350)} onSaved={(f, o) => { setFly(f); if (o?.started) return; if (f.mode === 'confirm' && watchesBsc(f)) void offerAuto(); else if (f.mode === 'confirm' && watchesChain(f, 'solana')) void offerSolAuto() }} />
      <AutoTradeSheet open={autoOpen} onClose={() => { setAutoOpen(false); setAutoKey((n) => n + 1) }} onChanged={() => setAutoKey((n) => n + 1)} />
      <SolAutoTradeSheet open={solOpen} onClose={() => { setSolOpen(false); setAutoKey((n) => n + 1) }} onChanged={() => setAutoKey((n) => n + 1)} />
    </div>
  )
}

function Curve({ values }: { values: number[] }) {
  const w = 320, h = 60, min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(' ')
  const up = values[values.length - 1] >= values[0]
  return <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('真实账户权益观测序列，按观测顺序排列')} className="mt-2 h-16 w-full rounded-xl bg-card"><polyline points={pts} fill="none" stroke={up ? '#4ade80' : '#f87171'} strokeWidth="2" strokeLinejoin="round" /></svg>
}
