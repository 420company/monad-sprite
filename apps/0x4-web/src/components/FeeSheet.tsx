// 「我」页 → 账户种类（2026-09-27，goat：入口叫「账户种类：普通 / VIP」）：当前等级、各项手续费（用户总共付的）、离 VIP 还差多少
import { useEffect } from 'react'
import { Crown } from 'lucide-react'
import Sheet from '@/components/Sheet'
import { PERP_ENABLED } from '@/lib/features'
import { LIFI_FEE_BPS, useFees } from '@/lib/fees'
import { fmtUsd } from '@/lib/format'
import { t } from '@/lib/i18n'

const pct = (n: number) => `${Number(n.toFixed(4))}%`

export default function FeeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const f = useFees((s) => s.fees)
  useEffect(() => { if (open) useFees.getState().load(true) }, [open])
  // 用户总共付的：现货 Solana = 我们的；EVM = 我们的 + LI.FI；合约市价单 = 我们的 + Aster 吃单 0.04%
  const rows: [string, string][] = [
    [t('现货（Solana）'), pct(f.solBps / 100)],
    [t('现货（BNB Chain、以太坊等）'), pct((f.evmBps + LIFI_FEE_BPS) / 100)],
    ...(PERP_ENABLED ? [[t('合约（市价单）'), pct((f.perpRate + 0.0004) * 100)], [t('合约（限价挂单）'), pct(f.perpRate * 100)]] as [string, string][] : []),
  ]
  const bars: [string, number, number][] = [[t('现货累计交易额'), f.volume.spot, f.target.spot], ...(PERP_ENABLED ? [[t('合约累计交易额'), f.volume.perp, f.target.perp]] as [string, number, number][] : [])]
  return (
    <Sheet open={open} onClose={onClose} title={t('账户种类')}>
      {/* VIP 用和首页勋章同一套金色（2026-09-29） */}
      <div className={`flex items-center gap-3 rounded-2xl p-4 ${f.vip ? 'tier-card-vip' : 'bg-card2'}`}>
        <Crown size={22} className={f.vip ? 'tier-gold' : 'text-muted'} aria-hidden="true" />
        <div>
          <div className="text-base font-semibold">{t('账户种类：{kind}', { kind: f.vip ? 'VIP' : t('普通') })}</div>
          <div className="mt-0.5 text-xs text-muted">{f.vip ? t('所有交易享受 VIP 费率') : PERP_ENABLED ? t('现货累计 {spot} 或合约累计 {perp}，自动升级 VIP', { spot: fmtUsd(f.target.spot, { compact: true }), perp: fmtUsd(f.target.perp, { compact: true }) }) : t('现货累计 {spot}，自动升级 VIP', { spot: fmtUsd(f.target.spot, { compact: true }) })}</div>
        </div>
      </div>
      <div className="mt-4 divide-y divide-line/60 rounded-2xl bg-card px-4">
        {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between py-3 text-sm"><span className="text-muted">{k}</span><span className="font-semibold tabular-nums">{v}</span></div>)}
      </div>
      {!f.vip && (
        <div className="mt-4 space-y-3">
          {bars.map(([k, v, max]) => (
            <div key={k}>
              <div className="flex justify-between text-xs"><span className="text-muted">{k}</span><span className="tabular-nums">{fmtUsd(v, { compact: true })} / {fmtUsd(max, { compact: true })}</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></div>
              {v < max && <div className="mt-1 text-right text-xs tabular-nums text-muted">{t('还差 {v}', { v: fmtUsd(max - v, { compact: true }) })}</div>}
            </div>
          ))}
          <p className="text-xs leading-relaxed text-muted">{t('交易额在成交确认后自动计入，可能有几分钟延迟。')}</p>
        </div>
      )}
    </Sheet>
  )
}
