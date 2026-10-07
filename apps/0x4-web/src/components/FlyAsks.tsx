// Per-order perp confirms (2026-09-28, GPT review #8): when the owner is online on desktop with "confirm each trade first" on, the sprite's perp orders don't go out directly —
// a request is created first (valid 10 min); the order goes out only when the owner approves in the desktop game or here. Rejected or expired = no order.
// Approving only greenlights this one order: coin, side, margin, and leverage are fixed in the request, and the trade process re-checks that the price hasn't moved beyond 2% before executing.
import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import Button from './Button'
import { toast } from './Toast'
import { api, type FlyAsk } from '@/lib/social'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

/** Open-long / open-short / close-long / close-short: closing goes opposite the position (sell to close long, buy to close short) */
export function askLabel(a: Pick<FlyAsk, 'side' | 'action'>) {
  if (a.action === 'close') return a.side === 'SELL' ? t('平多') : t('平空')
  return a.side === 'BUY' ? t('开多') : t('开空')
}
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export default function FlyAsks({ flyId }: { flyId: string }) {
  const seq = useSocial((s) => s.flyAskSeq)
  const [list, setList] = useState<FlyAsk[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    api<{ list: FlyAsk[] }>('/api/fly/asks').then((r) => { if (alive) setList((r.list || []).filter((a) => a.flyId === flyId)) }).catch(() => {})
    return () => { alive = false }
  }, [flyId, seq])
  // Countdown refreshes every 15s; expired ones vanish on their own
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(h) }, [])
  const live = list.filter((a) => a.expiresAt > now)
  if (!live.length) return null
  const decide = async (a: FlyAsk, approve: boolean) => {
    setBusy(a.id)
    try {
      await api(`/api/fly/asks/${a.id}`, { method: 'POST', body: JSON.stringify({ approve }) })
      setList((l) => l.filter((x) => x.id !== a.id))
      toast.success(approve ? t('已同意，小精灵马上下单') : t('已拒绝这笔交易'))
    } catch (e) {
      toast.error(errorText(e, t('操作失败')))
      setList((l) => l.filter((x) => x.id !== a.id))
    } finally { setBusy(null) }
  }
  return (
    <section className="mt-4 space-y-2" aria-label={t('等你确认的合约交易')}>
      {live.map((a) => {
        const buy = a.action === 'open' ? a.side === 'BUY' : a.side === 'SELL'   // Open-long / close-long use the up color
        return (
          <div key={a.id} className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-semibold text-accent">{t('等你确认')}</span>
              <span className="tabular-nums">{t('{n} 分钟内有效', { n: Math.max(1, Math.ceil((a.expiresAt - now) / 60000)) })}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-lg font-bold ${buy ? 'text-up' : 'text-down'}`}>{askLabel(a)}</span>
              <span className="text-lg font-bold">{a.coin}</span>
              <span className="ml-auto rounded-full bg-card2 px-2 py-0.5 text-xs font-semibold tabular-nums">{a.leverage}x</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl bg-card text-center">
              <div className="px-3 py-2"><dt className="text-[11px] text-muted">{t('保证金')}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{fmt(a.marginUsd)} <span className="text-xs font-normal text-muted">USDT</span></dd></div>
              <div className="border-l border-line/70 px-3 py-2"><dt className="text-[11px] text-muted">{t('仓位价值')}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{fmt(a.notional)} <span className="text-xs font-normal text-muted">USDT</span></dd></div>
            </dl>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!!busy} onClick={() => decide(a, false)}><X size={16} aria-hidden="true" />{t('拒绝')}</Button>
              <Button loading={busy === a.id} disabled={!!busy} onClick={() => decide(a, true)}><Check size={16} aria-hidden="true" />{t('同意下单')}</Button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
