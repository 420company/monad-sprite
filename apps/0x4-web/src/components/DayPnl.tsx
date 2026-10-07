// Home page today's PnL (2026-09-29 goat: "build a Binance-like feature — today's PnL on total balance, spot and perps included"):
// One row under the balance (amount + percentage; green up, red down, neutral at zero); tap to see the wallet / perp account split; hidden together with the balance.
// Account badge under the address ("better add two badges under the wallet address — one for regular accounts, one for VIP"): taps open the "account type" panel.
import { ChevronRight, Crown } from 'lucide-react'
import Sheet from '@/components/Sheet'
import { fmtMoney, fmtUsd } from '@/lib/format'
import { pnlSign, type DaySummary } from '@/lib/dayPnl'
import { useFees } from '@/lib/fees'
import { useSocial } from '@/store/social'
import { locale, t } from '@/lib/i18n'

const tone = (v: number) => (pnlSign(v) > 0 ? 'text-up' : pnlSign(v) < 0 ? 'text-down' : 'text-muted')
/** +$12.34 / -$5.00; under half a cent shows $0.00 */
export const signedMoney = (v: number) => (pnlSign(v) === 0 ? '$0.00' : `${v > 0 ? '+' : '-'}${fmtMoney(Math.abs(v))}`)
/** +1.02% / -0.50%; 0.00% when PnL is zero */
export const signedPct = (pnl: number, pct: number) => (pnlSign(pnl) === 0 || Math.abs(pct) < 0.005 ? '0.00%' : `${pct > 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`)
const money = (v: number) => (v >= 1e6 ? fmtUsd(v, { compact: true }) : fmtMoney(v))

/** The row under the balance */
export function DayPnlLine({ summary, hidden, onOpen }: { summary: DaySummary | null; hidden: boolean; onOpen: () => void }) {
  if (!summary) return null
  return (
    <button onClick={onOpen} className="-ml-0.5 flex min-h-8 max-w-full items-center gap-1.5 text-[13px]" aria-label={t('查看今日盈亏')} data-testid="day-pnl">
      <span className="shrink-0 text-muted">{t('今日盈亏')}</span>
      {hidden
        ? <span className="number text-muted">****</span>
        : <span className={`number truncate font-medium ${tone(summary.pnl)}`}>{signedMoney(summary.pnl)}{summary.pct !== null && <span className="ml-1">({signedPct(summary.pnl, summary.pct)})</span>}</span>}
      <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
  )
}

/** The breakdown panel on tap */
export function DayPnlSheet({ open, onClose, summary, hidden, walletUsd }: { open: boolean; onClose: () => void; summary: DaySummary | null; hidden: boolean; walletUsd: number | null }) {
  const mask = (s: string) => (hidden ? '****' : s)
  const rows: { label: string; value: string | null; pnl: number }[] = []
  if (summary?.spot) rows.push({ label: t('钱包'), value: walletUsd === null ? null : money(walletUsd), pnl: summary.spot.pnl })
  if (summary?.perp) rows.push({ label: t('合约账户'), value: money(summary.perp.equity), pnl: summary.perp.pnl })
  // Same timezone as "counted from Beijing midnight" — not the phone's local timezone
  const lateAt = summary?.perp?.late ? new Date(summary.perp.since).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }) : null
  return (
    <Sheet open={open} onClose={onClose} title={t('今日盈亏')}>
      {summary && <>
        <div className="glass-lite rounded-[22px] px-5 py-4">
          <div className="text-[13px] text-muted">{new Date().toLocaleDateString(locale(), { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })}</div>
          <div className={`number mt-1 text-[28px] font-semibold leading-tight ${hidden ? '' : tone(summary.pnl)}`}>{mask(signedMoney(summary.pnl))}</div>
          {summary.pct !== null && <div className={`number mt-1 text-sm font-medium ${hidden ? 'text-muted' : tone(summary.pnl)}`}>{mask(signedPct(summary.pnl, summary.pct))}</div>}
        </div>
        {rows.length > 0 && (
          <div className="mt-4 divide-y divide-line/60 rounded-2xl bg-card px-4">
            {rows.map((r) => (
              <div key={r.label} className="flex min-h-14 items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm">{r.label}</div>
                  {r.value !== null && <div className="number mt-0.5 text-xs text-muted">{t('资产 {v}', { v: mask(r.value) })}</div>}
                </div>
                <div className={`number shrink-0 text-sm font-semibold ${hidden ? 'text-muted' : tone(r.pnl)}`}>{mask(signedMoney(r.pnl))}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 space-y-1.5 text-xs leading-relaxed text-muted">
          <p>{t('北京时间 0 点起算，只计算价格涨跌。充值、提现、转账、兑换及其手续费不计入。')}</p>
          {!!summary.spot?.partial && <p>{t('{n} 项资产从今天首次读取时起算。', { n: summary.spot.partial })}</p>}
          {lateAt && <p>{t('合约从北京时间 {time} 起算。', { time: lateAt })}</p>}
          {summary.pct === null && <p>{t('初始资产不足 1 美元，不显示百分比。')}</p>}
        </div>
      </>}
    </Sheet>
  )
}

/** Badge under the address: shown only when the fee-tier API delivers (never guessed); after switching accounts, wait for the new account's tier */
export function AccountBadge({ onOpen }: { onOpen: () => void }) {
  const vip = useFees((s) => s.fees.vip)
  const loadedFor = useFees((s) => (s.loadedAt > 0 ? s.account : null))
  const me = useSocial((s) => s.me?.address)
  if (!me || loadedFor !== me) return null
  return (
    <button onClick={onOpen} className="tier-badge" data-vip={vip} aria-label={t('账户种类：{kind}', { kind: vip ? 'VIP' : t('普通') })} data-testid="tier-badge">
      {vip && <Crown size={11} strokeWidth={2.4} aria-hidden="true" />}
      {vip ? 'VIP' : t('普通账户')}
    </button>
  )
}
