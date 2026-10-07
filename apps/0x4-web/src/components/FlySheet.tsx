// Raise / edit a fruit fly: name it, pick tokens, personality (decode threshold), learning toggle, observation frequency. After adoption, pick the trading mode (confirm / perp) on the detail page — no paper trading
import { useEffect, useState } from 'react'
import Button from './Button'
import Sheet from './Sheet'
import TokenPicker, { type PickedToken } from './TokenPicker'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { api, type Fly, type FlyAutoPick, type FlyParams, type FlyPlan, type FlyPlanDef, type ZalienCard } from '@/lib/social'
import { TopupSheet, useGiftWallet } from './GiftSheet'
import { fmtUsd } from '@/lib/format'
import { chainById, forQuote, MARKET_PRIMARY, NATIVE_EVM } from '@/lib/chains'
import { t } from '@/lib/i18n'
import { BALANCE_FEATURES } from '@/lib/features'
import { nameError } from '@/lib/names'
import { errorText } from '@/lib/errors'

// Max tokens one fly watches — matches the backend's server/src/fly.ts MAX_TOKENS (set to 5 on 2026-09-27)
const MAX_TOKENS = 5
// The 5 default focus chains for auto token-picking (goat 2026-09-27) — matches the backend's autoPick.ts AUTO_DEFAULT_CHAINS
const AUTO_DEFAULT = ['robinhood', 'solana', 'base', 'bsc', 'ethereum']

const STYLES = [[3, '保守', '信号足够强时才交易'], [2, '均衡', '兼顾信号强度与交易频率'], [1, '激进', '信号较弱时也会交易，交易更频繁']] as const
/** Default watched tokens for new adoptions (same as the server fly.ts's DEFAULT_TOKENS) */
export const DEFAULT_FLY_TOKENS: FlyParams['tokens'] = [{ chain: 'bsc', address: forQuote('bsc', NATIVE_EVM), symbol: 'BNB' }]

export default function FlySheet({ open, onClose, fly, onSaved, plans, remaining, grant, card, cards }: { open: boolean; onClose: () => void; fly?: Fly | null; onSaved: (f: Fly) => void; plans?: Record<FlyPlan, FlyPlanDef>; remaining?: number; grant?: { plan: FlyPlan; months: number; note: string | null } | null; card?: { tokenId: number; free: boolean } | null; cards?: ZalienCard[] }) {
  const { wallet, reload } = useGiftWallet()
  const [plan, setPlan] = useState<FlyPlan>('basic')
  const [topup, setTopup] = useState(false)
  const [name, setName] = useState('')
  // Name rules (set by goat 2026-09-28): only checked on new names or renames — existing names are unaffected; blank uses the default name
  const nameBad = name.trim() && (!fly || name.trim() !== fly.name) ? nameError(name.trim()) : null
  // Defaults to watching BNB on BNB Chain (2026-10-04 goat: fully-auto spot only does BNB Chain). Stored as WBNB, displayed as BNB — same as the market watchlist
  const [tokens, setTokens] = useState<FlyParams['tokens']>(DEFAULT_FLY_TOKENS)
  const [advanced, setAdvanced] = useState(false)
  // Token-picking mode: manual / auto (auto defaults to hot tokens on the 5 focus chains; one sprite watches at most 5 chains)
  const [auto, setAuto] = useState<FlyAutoPick | null>(null)
  const [threshold, setThreshold] = useState(2)
  const [learning, setLearning] = useState(true)
  const [senses, setSenses] = useState<('funding' | 'oi')[]>([])
  const [calib, setCalib] = useState(false)  // Decode zero-point calibration: decoderBaseline 100 / 0
  const [cadence, setCadence] = useState(5)
  const [budget, setBudget] = useState('100')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(fly?.name || ''); setAuto(fly?.params.autoPick ?? null); setTokens(fly?.params.tokens || DEFAULT_FLY_TOKENS); setThreshold(fly?.params.thresholdHz || 2)
    setLearning(fly?.params.learning ?? true); setSenses(fly?.params.senses || []); setCalib(!!fly?.params.decoderBaseline); setCadence(fly?.params.cadenceMin || 5); setBudget(String(fly?.params.budget || 100)); setPlan(fly?.plan || 'basic')
  // Read once on open (or when switching sprites): the sprite page swaps in a new fly object on every data update — following fly changes used to wipe unsaved edits in progress (2026-10-05 goat: "why can't it save")
  }, [open, fly?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Adopting a new fly is free with a gifting slot available. The backend (fly.ts) free branch forces the grant's plan,
  // so the frontend must lock along — otherwise the user picks Pro but actually gets Basic.
  // Adopt with Zalien: the free adoption window (once per card) grants Basic; otherwise it's the gifting list or paid
  const cardFree = !fly && !!card?.free
  const cardImg = card ? cards?.find((c) => c.tokenId === card.tokenId)?.image : undefined
  const free = !fly && (cardFree || (!card && !!grant))
  const effPlan: FlyPlan = cardFree ? 'basic' : free && grant ? grant.plan : plan
  const price = plans?.[effPlan]?.price ?? (effPlan === 'pro' ? 30 : 10)
  const minCadence = plans?.[effPlan]?.minCadence ?? (effPlan === 'pro' ? 1 : 5)
  const enough = free || (!!wallet && wallet.balance >= price)
  const addToken = (tok: PickedToken) => {
    const chain = chainById(tok.chainId)?.dexKey || 'solana'
    // The fly's stored address is only used for quote lookups, so native coins must be stored wrapped — otherwise DexScreener can't find them
    const address = forQuote(chain, tok.address)
    if (tokens.some((x) => x.address === address)) return
    // Same-name tokens are deduped by the backend (flies tell tokens apart by symbol) — intercept here first and say so clearly
    if (tokens.some((x) => x.symbol.toUpperCase() === tok.symbol.toUpperCase())) return toast.error(t('已添加同名币种 {symbol}', { symbol: tok.symbol }))
    if (tokens.length >= MAX_TOKENS) return toast.error(t('最多可关注 {n} 个币种', { n: MAX_TOKENS }))
    setTokens([...tokens, { chain, address, symbol: tok.symbol }])
  }
  const save = async () => {
    if (nameBad) return toast.error(nameBad)
    setBusy(true)
    try {
      const params = { autoPick: auto, tokens, thresholdHz: threshold, learning, cadenceMin: cadence, budget: Number(budget) || 100, senses, decoderBaseline: calib ? 100 : 0 }
      if (!fly && !enough) { setTopup(true); setBusy(false); return }
      const f = fly ? await api<Fly>(`/api/flies/${fly.id}`, { method: 'PUT', body: JSON.stringify({ name, params }) }) : await api<Fly>('/api/flies', { method: 'POST', body: JSON.stringify({ name, params, plan: effPlan, tokenId: card?.tokenId }) })
      toast.success(fly ? t('设置已保存，记录将按新设置重新开始') : t('领养成功'))
      onSaved(f)
    } catch (e) { const msg = errorText(e, t('失败')); if (msg.includes('余额不足')) setTopup(true); else toast.error(msg) } finally { setBusy(false) }
  }
  // Only the parameter grouping and control presentation are adjusted; plans, submit params, and mode descriptions stay.
  return (
    <Sheet open={open} onClose={onClose} title={fly ? t('调整设置') : t('领养小精灵')}>
      <div className="space-y-5">
        {card && !fly && (
          <section className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-card p-3">
            {cardImg ? <img src={cardImg} alt="" className="size-14 shrink-0 rounded-xl bg-card2 object-cover" /> : null}
            <div className="min-w-0"><div className="text-base font-semibold">Zalien #{card.tokenId}</div><div className="text-xs text-muted">{cardFree ? t('免费 1 个月') : t('此卡的免费领养期已使用')}</div></div>
          </section>
        )}
        <section className="space-y-3">
          {fly && <div><div className="text-[11px] font-semibold uppercase tracking-[.14em] text-accent">{t('基本信息')}</div><div className="mt-1 text-xs text-muted">{t('为小精灵命名并选择关注的币种。修改设置后，交易记录将重新开始。')}</div></div>}
          <div><Label htmlFor="fly-name">{t('名字')}</Label><Input id="fly-name" className="text-base" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('例如：夜行者')} maxLength={16} aria-invalid={!!nameBad} />
            {(fly || nameBad) && <p className={`mt-1 text-xs ${nameBad ? 'text-down' : 'text-muted'}`}>{nameBad || t('最多 8 个汉字或 16 个字母数字，不能有空格和符号')}</p>}</div>
        </section>
        {!auto && <section>
          <Label>{fly ? t('关注的币种（最多 {n} 个，轮流观察）', { n: MAX_TOKENS }) : t('关注的币')}</Label>
          <div className="flex flex-wrap gap-2">
            {tokens.map((tk) => <button key={tk.address} aria-label={t('移除 {symbol}', { symbol: tk.symbol })} onClick={() => setTokens(tokens.filter((x) => x !== tk))} className="min-h-11 rounded-lg bg-card2 px-3 py-2 text-sm font-semibold transition-transform active:scale-[.98]">{tk.symbol} <span className="text-muted">×</span></button>)}
            {tokens.length < MAX_TOKENS && <button onClick={() => setPicking(true)} className="min-h-11 rounded-lg border border-dashed border-line px-3 py-1 text-sm text-muted">+ {t('加一个')}</button>}
          </div>
        </section>}
        {/* Adoption only asks for name and tokens (2026-10-05 goat: "keep the wording dead simple"); pro settings like picking mode, trading style, and observation frequency go under "Advanced settings" with defaults unchanged */}
        {!fly && <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-sm text-muted" aria-expanded={advanced}>{advanced ? t('收起高级设置') : t('高级设置')}</button>}
        {(fly || advanced) && <div className="space-y-5">
        <section>
          <Label>{t('选币方式')}</Label>
          <div className="flex rounded-xl border border-line/70 bg-card p-1">{([[false, '自己选'], [true, '自动找币']] as const).map(([v, l]) => <button key={l} aria-pressed={!!auto === v} onClick={() => setAuto(v ? (auto ?? { source: 'hot', chains: AUTO_DEFAULT }) : null)} className={`min-h-11 flex-1 rounded-lg py-2 text-sm font-semibold transition-transform active:scale-[.98] ${!!auto === v ? 'bg-card2 text-fg shadow-sm' : 'text-muted'}`}>{t(l)}</button>)}</div>
          {auto && <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-muted">{t('小精灵每 30 分钟从榜单里挑最多 5 个币观察，只挑流动性和成交额达标、并通过安全检测的币。已买入的币会一直观察到卖出。仅在现货模式下生效：未开启全自动时每笔由你确认，开启后 BNB Chain 上的买卖按每日额度自动执行。')}</p>
            <div><div className="mb-1.5 text-xs font-semibold text-muted">{t('榜单')}</div>
              <div className="flex gap-2">{([['hot', '热门'], ['new', '最新'], ['both', '两者']] as const).map(([v, l]) => <button key={v} aria-pressed={auto.source === v} onClick={() => setAuto({ ...auto, source: v })} className={`min-h-10 flex-1 rounded-lg text-sm font-semibold ${auto.source === v ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{t(l)}</button>)}</div>
              {auto.source !== 'hot' && <p className="mt-1.5 text-xs text-down">{t('最新上线的币风险高很多，请谨慎。')}</p>}</div>
            <div><div className="mb-1.5 flex items-baseline justify-between text-xs font-semibold text-muted"><span>{t('监控的链')}</span><span className="tabular-nums">{auto.chains.length} / 5</span></div>
              <div className="flex flex-wrap gap-2">{MARKET_PRIMARY.map((c) => { const on = auto.chains.includes(c.dexKey); return <button key={c.dexKey} aria-pressed={on} onClick={() => { if (on) { if (auto.chains.length > 1) setAuto({ ...auto, chains: auto.chains.filter((x) => x !== c.dexKey) }) } else if (auto.chains.length >= 5) toast.error(t('一只小精灵最多监控 5 条链')); else setAuto({ ...auto, chains: [...auto.chains, c.dexKey] }) }} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${on ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{c.label}</button> })}</div></div>
          </div>}
        </section>
        <section>
          <Label>{t('交易风格')}</Label>
          <div className="flex rounded-xl border border-line/70 bg-card p-1">{STYLES.map(([v, l]) => <button key={v} aria-pressed={threshold === v} onClick={() => setThreshold(v)} className={`min-h-11 flex-1 rounded-lg py-2 text-sm font-semibold transition-transform active:scale-[.98] ${threshold === v ? 'bg-card2 text-fg shadow-sm' : 'text-muted'}`}>{t(l)}</button>)}</div>
          <div className="mt-1 text-xs text-muted">{t(STYLES.find(([v]) => v === threshold)?.[2] ?? '')}</div>
        </section>
        <section className="space-y-2">
        <label className="flex items-center justify-between rounded-xl bg-card2 px-4 py-3">
          <span className="text-sm"><span className="font-semibold">{t('持续学习')}</span><span className="block text-xs text-muted">{t('小精灵会根据交易盈亏调整自身判断。')}</span></span>
          <input type="checkbox" checked={learning} onChange={(e) => setLearning(e.target.checked)} className="h-5 w-5 accent-accent" />
        </label>
        {/* Experimental senses: draw perp market structure into the chart the fly sees. All off by default = the control group.
            Each toggle only adds one band to the chart — decoding and plasticity untouched; the sprite decides whether to use them. */}
        <div className="rounded-xl border border-line/60 bg-card2 p-3">
          <div className="text-sm font-semibold">{t('参考合约市场数据')}<span className="ml-2 text-[11px] font-normal text-muted">{t('仅对有永续合约的币种生效')}</span></div>
          <div className="mt-2 space-y-2">
            {([['funding', '资金费率', '多空双方的资金成本'], ['oi', '持仓量', '市场整体仓位的增减']] as const).map(([k, label, d]) => (
              <label key={k} className="flex items-start justify-between gap-3">
                <span className="text-xs"><span className="font-semibold">{t(label)}</span><span className="block text-muted">{t(d)}</span></span>
                <input type="checkbox" checked={senses.includes(k)} onChange={(e) => setSenses(e.target.checked ? [...senses, k] : senses.filter((x) => x !== k))} className="mt-0.5 h-5 w-5 shrink-0 accent-accent" />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">{fly ? t('修改后，交易记录将重新开始。') : t('默认关闭。')}</p>
        </div>
        {/* Decode zero-point calibration: the right hemisphere idles ~7 Hz higher than the left — uncalibrated, 90% of outputs are BUY. Only subtracts the median of its own firing history; PnL ignored, mapping unchanged (docs/FLY_DECODER.md) */}
        <div className="rounded-xl border border-line/60 bg-card2 p-3">
          <label className="flex items-start justify-between gap-3">
            <span className="text-xs"><span className="text-sm font-semibold">{t('方向校准')}</span><span className="block text-muted">{t('避免小精灵长期偏向只买或只卖。')}</span></span>
            <input type="checkbox" checked={calib} onChange={(e) => setCalib(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-accent" />
          </label>
          {fly && <p className="mt-2 text-[11px] text-muted">{t('修改后，交易记录将重新开始。')}</p>}
        </div>
        </section>
        <section>
          <Label>{t('观察频率')}</Label>
          <div className="flex gap-2">{[1, 5, 15, 60].map((m) => <button key={m} aria-pressed={cadence === m} disabled={m < minCadence} onClick={() => setCadence(m)} className={`min-h-11 flex-1 rounded-lg py-2 text-sm font-semibold transition-transform active:scale-[.98] disabled:opacity-40 ${cadence === m ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{m < 60 ? t('{n} 分钟', { n: m }) : t('1 小时')}</button>)}</div>
          {minCadence > 1 && !cardFree && BALANCE_FEATURES && <div className="mt-1 text-[11px] text-muted">{t('每 1 分钟观察一次需选择进阶版')}</div>}
        </section>
        </div>}
        {!fly && !cardFree && (
          <section>
            <Label>{free ? t('套餐（赠送，不可更改）') : t('套餐（按月从余额支付）')}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['basic', 'pro'] as const).map((k) => <button key={k} aria-pressed={effPlan === k} disabled={free && k !== effPlan} onClick={() => { if (free) return; setPlan(k); if (k === 'basic' && cadence < 5) setCadence(5) }} className={`rounded-xl p-3 text-left disabled:opacity-35 ${effPlan === k ? 'bg-accent/15 ring-2 ring-accent' : 'bg-card2'}`}><div className="font-semibold">{plans?.[k]?.label || (k === 'pro' ? t('进阶版') : t('基础版'))} <span className="text-accent">{t('{price}/月', { price: fmtUsd(plans?.[k]?.price ?? (k === 'pro' ? 30 : 10)) })}</span></div><div className="mt-0.5 text-[11px] text-muted">{k === 'pro' ? t('最快每 1 分钟观察一次，占用 5 个名额') : t('最快每 5 分钟观察一次，占用 1 个名额')}</div></button>)}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{free ? t('赠送 {n} 个月，本次不扣费', { n: grant?.months ?? 1 }) : <>{t('余额 {amount}', { amount: wallet ? fmtUsd(wallet.balance) : '--' })}{!enough && <button onClick={() => setTopup(true)} className="ml-2 text-accent">{t('去充值')}</button>}</>}</span>
              {remaining !== undefined && <span>{t('本月剩余名额 {n}', { n: remaining })}</span>}
            </div>
          </section>
        )}
        <Button size="lg" className="w-full" disabled={!auto && !tokens.length} loading={busy} onClick={save}>{fly ? t('保存') : cardFree ? t('免费领养') : free ? t('免费领养') : enough ? t('领养 · {price}', { price: fmtUsd(price) }) : t('余额不足，先充值 {price}', { price: fmtUsd(price) })}</Button>
      </div>
      <TokenPicker open={picking} onClose={() => setPicking(false)} title={t('选择关注的币种')} onSelect={addToken} />
      <TopupSheet open={topup} onClose={() => { setTopup(false); reload() }} wallet={wallet} need={Math.max(0, price - (wallet?.balance || 0))} />
    </Sheet>
  )
}
