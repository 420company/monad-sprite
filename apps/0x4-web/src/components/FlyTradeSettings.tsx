// 手机端「交易设置」（2026-09-27）：手机上只管交易相关的参数，性格、社交、生活这些在电脑端 Cyber Eden 里设。
// 开单方式 → 交易方式面板（RealModeSheet）/ 暂停；币种和性格 → 调参数面板（FlySheet）；
// 审批规则、日亏停手、公开范围 → /api/flies/:id/prefs（改它们不会重开账本）。
import { useEffect, useState } from 'react'
import { PERP_ENABLED } from '@/lib/features'
import { ChevronRight } from 'lucide-react'
import { toast } from '@/components/Toast'
import { api, type Fly, type FlyPrefs, type HoldStyle } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { t } from '@/lib/i18n'
import AutoTradeSheet from '@/components/AutoTradeSheet'
import SolAutoTradeSheet from '@/components/SolAutoTradeSheet'
import { solAutoStatus, type SolAutoStatus } from '@/lib/solAuto'
import { watchesChain } from '@/lib/flyChains'
import { autoStatus, type AutoStatus } from '@/lib/autoTrade'
import { errorText } from '@/lib/errors'

const MAX = 1_000_000_000
const DEFAULT: FlyPrefs = { askWhenOnline: true, autoApproveUsd: 0, dailyStopUsd: 0, publicPnl: true, publicPositions: true, holdStyle: 'quick' }
// 钻石手三档（2026-09-27 goat 定）
const HOLD: [HoldStyle, string, string][] = [
  ['quick', '快进快出', ''],
  ['double', '翻倍出本', '买入后交给你；涨到 2 倍时建议卖一半拿回本金，剩下的继续拿着'],
  ['diamond', '钻石手', '买入后交给你，只提醒，永远不替你卖'],
]

export default function FlyTradeSettings({ fly, part, onChanged, onOpenMode, onOpenParams, autoKey = 0 }: { fly: Fly; part: 'trade' | 'risk'; onChanged: (f: Fly) => void; onOpenMode: () => void; onOpenParams: () => void; /** 详情页那边开关过全自动后加一，这里重新读状态 */ autoKey?: number }) {
  const prefs: FlyPrefs = { ...DEFAULT, ...(fly.prefs || {}) }
  const [busy, setBusy] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)
  const [auto, setAuto] = useState<AutoStatus | null>(null)
  // 全自动是账户级的：不管这只小精灵是什么模式都查一次，开着就显示入口（第七轮复核 #15）
  useEffect(() => { autoStatus().then(setAuto).catch(() => {}) }, [fly.mode, autoKey])
  // Solana 版全自动（2026-10-04）：看 Solana 币的小精灵另有一行
  const [solOpen, setSolOpen] = useState(false)
  const [solAuto, setSolAuto] = useState<SolAutoStatus | null>(null)
  const onSol = watchesChain(fly, 'solana'), onBsc = watchesChain(fly, 'bsc')
  useEffect(() => { if (onSol) solAutoStatus().then(setSolAuto).catch(() => {}) }, [fly.mode, autoKey, onSol])
  const [approve, setApprove] = useState(String(prefs.autoApproveUsd || ''))
  const [stop, setStop] = useState(String(prefs.dailyStopUsd || ''))
  useEffect(() => { setApprove(String(prefs.autoApproveUsd || '')); setStop(String(prefs.dailyStopUsd || '')) }, [fly.id, prefs.autoApproveUsd, prefs.dailyStopUsd])

  const save = async (patch: Partial<FlyPrefs & { paused: boolean }>) => {
    setBusy(true)
    try {
      if ('paused' in patch) onChanged(await api<Fly>(`/api/flies/${fly.id}`, { method: 'PUT', body: JSON.stringify({ paused: patch.paused }) }))
      else onChanged(await api<Fly>(`/api/flies/${fly.id}/prefs`, { method: 'PUT', body: JSON.stringify(patch) }))
    } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setBusy(false) }
  }
  const money = (v: string) => { const n = Math.round(Number(v.replace(/[^\d.]/g, '')) * 100) / 100; return Number.isFinite(n) ? Math.min(MAX, Math.max(0, n)) : 0 }

  // 文案按实际行为写（第六轮查漏 #3 #4）：暂停的小精灵停止买卖；确认模式在开了全自动后，BNB Chain 上的买卖不再逐笔确认
  const autoOn = fly.mode === 'confirm' && !!auto?.active
  // 2026-10-05 goat「文字一定要简单」：叫法统一成 买卖币 / 合约、自动交易 / 每次先问我，小字只留一句
  const modeLabel = fly.paused ? t('已暂停') : !fly.activated ? t('未开始') : fly.mode === 'perp' ? t('合约交易') : autoOn ? t('自动交易') : t('每次先问我')
  const modeSub = fly.paused ? t('暂停后小精灵停止买卖，它已经帮你买到的币需要你自己处理') : fly.mode === 'perp' ? (PERP_ENABLED ? t('{lev}x · 单次保证金 {m}', { lev: fly.leverage, m: fmtUsd(fly.marginUsd) }) : t('当前的交易方式在此版本中不可用，可以改为现货模式')) : autoOn ? t('每天最多 {usd}', { usd: fmtUsd(auto?.perDayUsd ?? 0) }) : fly.mode === 'confirm' ? t('小精灵想买卖时会问你') : undefined

  // part：详情页分页后，「交易」页只放交易方式 / 暂停 / 币种，「风控」页放审批 / 止损 / 公开范围（2026-09-27 goat：不要一页拉很长）。
  // 合约模式的杠杆和单次保证金在「交易方式」里改，那一行的小字已经显示它们；原来单独一行「杠杆和单次保证金」打开的是同一个面板，重复了（2026-09-28 goat）
  if (part === 'trade') return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-line/70 bg-card" aria-label={t('交易设置')}>
      <Row title={t('交易方式')} value={modeLabel} sub={modeSub} onClick={onOpenMode} />
      <SwitchRow title={t('暂停')} checked={fly.paused} disabled={busy} onChange={() => save({ paused: !fly.paused })} />
      {fly.params.autoPick
        ? <Row title={t('关注币种与交易风格')} value={t('自动 · {src} · {n} 条链', { src: t({ hot: '热门', new: '最新', both: '两者' }[fly.params.autoPick.source]), n: fly.params.autoPick.chains.length })} sub={fly.autoTokens?.length ? t('现在在看：{list}', { list: fly.autoTokens.map((x) => x.symbol).join(' / ') }) : fly.mode === 'confirm' ? t('正在从榜单里挑币') : undefined} onClick={onOpenParams} />
        : <Row title={t('关注币种与交易风格')} value={fly.params.tokens.length > 3 ? t('{n} 个币', { n: fly.params.tokens.length }) : fly.params.tokens.map((x) => x.symbol).join(' / ')} onClick={onOpenParams} />}
      {/* 现货全自动（B 方案）：账户级设置，开了之后所有小精灵在 BNB Chain 上的买卖都自动执行 */}
      {(fly.mode === 'confirm' || auto?.active) && (onBsc || !onSol) && <Row title={onSol ? t('自动交易（BNB Chain）') : t('自动交易')} value={auto?.active ? t('已开启') : t('未开启')} onClick={() => setAutoOpen(true)} />}
      {(fly.mode === 'confirm' || solAuto?.active) && onSol && <Row title={onBsc ? t('自动交易（Solana）') : t('自动交易')} value={solAuto?.active ? t('已开启') : t('未开启')} onClick={() => setSolOpen(true)} />}
      {fly.mode !== 'perp' && (
        <div className="border-t border-line/70 px-4 py-3" role="radiogroup" aria-label={t('持有方式')}>
          <div className="text-[15px]">{t('持有方式')}</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {HOLD.map(([k, label]) => <button key={k} role="radio" aria-checked={prefs.holdStyle === k} disabled={busy} onClick={() => prefs.holdStyle !== k && save({ holdStyle: k })} className={`min-h-10 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${prefs.holdStyle === k ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{t(label)}</button>)}
          </div>
          {/* 快进快出不写说明（2026-10-05 goat「文字能少点」）；翻倍出本 / 钻石手会把币交给主人，得说清楚 */}
          {HOLD.find(([k]) => k === prefs.holdStyle)?.[2] ? <p className="mt-2 text-xs leading-relaxed text-muted">{t(HOLD.find(([k]) => k === prefs.holdStyle)![2])}</p> : null}
        </div>
      )}
      <AutoTradeSheet open={autoOpen} onClose={() => setAutoOpen(false)} onChanged={setAuto} />
      {onSol && <SolAutoTradeSheet open={solOpen} onClose={() => setSolOpen(false)} onChanged={setSolAuto} />}
    </section>
  )
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-line/70 bg-card" aria-label={t('风控')}>
      <Group label={t('审批')} first>
        <SwitchRow title={t('电脑端在线时，每笔交易先经我确认')} checked={prefs.askWhenOnline} disabled={busy || fly.mode !== 'perp'} onChange={() => save({ askWhenOnline: !prefs.askWhenOnline })} />
        {/* 按保证金算的免确认金额只对合约模式有意义；现货模式是否逐笔确认由「全自动交易」决定（第六轮查漏 #2）。
            2026-09-28 起这两项真正接进合约执行：电脑端在线时小精灵先发申请，主人在电脑端游戏或手机上同意才下单（GPT 审查 #8） */}
        {fly.mode === 'perp' && <MoneyRow title={t('低于此金额不用确认')} value={approve} onChange={setApprove} onCommit={() => { const n = money(approve); setApprove(n ? String(n) : ''); if (n !== prefs.autoApproveUsd) save({ autoApproveUsd: n }) }} disabled={busy} />}
      </Group>
      {/* 当日亏损闸（第六、七轮；2026-09-28 GPT 审查 #9 起合约模式也有）：现货按全自动买入的成本算、停自动买入；
          合约按小精灵自己的成交算（含未平仓盈亏，不受主人手动交易和充值提现影响），只停开新仓、平仓照常。两种都是次日恢复 */}
      <Group label={t('风控')}>
        {fly.mode === 'perp'
          ? <MoneyRow title={t('每日亏损上限')} hint={t('当天亏到这个数就不再开新仓，0 = 不限')} value={stop} onChange={setStop} onCommit={() => { const n = money(stop); setStop(n ? String(n) : ''); if (n !== prefs.dailyStopUsd) save({ dailyStopUsd: n }) }} disabled={busy} />
          : <MoneyRow title={t('每日亏损上限')} hint={t('当天亏到这个数就不再自动买入，0 = 不限')} value={stop} onChange={setStop} onCommit={() => { const n = money(stop); setStop(n ? String(n) : ''); if (n !== prefs.dailyStopUsd) save({ dailyStopUsd: n }) }} disabled={busy} />}
      </Group>
      <Group label={t('公开范围')}>
        <SwitchRow title={t('公开盈亏')} checked={prefs.publicPnl} disabled={busy} onChange={() => save({ publicPnl: !prefs.publicPnl })} />
        <SwitchRow title={t('公开持仓')} checked={prefs.publicPositions} disabled={busy} onChange={() => save({ publicPositions: !prefs.publicPositions })} />
      </Group>
    </section>
  )
}

function Group({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return <div className={first ? '' : 'border-t border-line/70'}><div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-[.12em] text-muted">{label}</div>{children}</div>
}
function Row({ title, value, sub, onClick }: { title: string; value: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-14 w-full items-center gap-3 border-t border-line/70 px-4 py-3 text-left first:border-t-0 active:bg-card2">
      <span className="min-w-0 flex-1"><span className="block text-[15px]">{title}</span>{sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}</span>
      <span className="max-w-[45%] truncate text-sm text-muted">{value}</span><ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
  )
}
function SwitchRow({ title, sub, checked, disabled, onChange }: { title: string; sub?: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={onChange} disabled={disabled} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-50">
      <span className="min-w-0"><span className="block text-[15px]">{title}</span>{sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-card2'}`} aria-hidden><span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
    </button>
  )
}
function MoneyRow({ title, hint, value, onChange, onCommit, disabled }: { title: string; hint?: string; value: string; onChange: (v: string) => void; onCommit: () => void; disabled?: boolean }) {
  const id = 'm' + title.length + (hint?.length ?? 0)
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1"><span className="block text-[15px]">{title}</span>{hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}</label>
      <div className="flex h-10 w-32 shrink-0 items-center gap-1 rounded-xl border border-line bg-card2 px-3"><span className="text-sm text-muted">$</span>
        <input id={id} inputMode="decimal" value={value} placeholder="0" disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="w-full min-w-0 bg-transparent text-right text-[15px] tabular-nums outline-none" />
      </div>
    </div>
  )
}
