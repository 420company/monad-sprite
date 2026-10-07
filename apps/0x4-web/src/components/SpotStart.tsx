// The start-trading entry on the "Spot trading" page of the trading-mode panel (2026-10-05 goat: "the launch-trading flow is too complex for users to follow" / "copy must be simple").
// It used to take four steps — pick spot / perps, check a long agreement, activate, then fill quota and days in the autopilot panel; now it only asks the daily max and starts with one button:
//   - Autopilot available (server enabled, BNB Chain coins only, 0x4 wallet): "Enable autopilot" = pick spot + enable autopilot (wallet signs once, valid 30 days);
//     "Ask me each time" below = spot selected without autopilot (same category as autopilot, hence placed under it; perps live in the panel's top tabs — goat: the two aren't the same category, don't place them side by side)
//   - Can't enable: only "Start" — the sprite asks the owner when it wants to trade
// The agreement line is placed uniformly by the outer trading-mode panel (tapping the button counts as agreeing).
import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import Button from './Button'
import { toast } from './Toast'
import { api, type Fly } from '@/lib/social'
import { autoConfig, autoStatus, enableAutoTrade, ForeignWalletError, HARD_MAX_PER_DAY, type AutoConfig } from '@/lib/autoTrade'
import { watchesChain } from '@/lib/flyChains'
import { useWallet } from '@/store/wallet'
import { usePortfolio } from '@/store/portfolio'
import { useExternalWallet } from '@/desktop/Ox4Only'
import { BSC_USDT } from '@/lib/aster'
import { sameAddr } from '@/lib/chains'
import { fmtUsd } from '@/lib/format'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

const AUTO_DAYS = 30

export default function SpotStart({ open, fly, onStarted, onDone, onAutoSheet, onAddFunds }: {
  open: boolean; fly: Fly
  /** The trading mode is already saved as spot (don't pop the autopilot panel again: the owner already chose here) */
  onStarted: (f: Fly) => void
  /** All done — close the panel */
  onDone: () => void
  /** Autopilot can't be enabled directly — needs the full panel (wallet upgraded to a smart account by another wallet, etc.) */
  onAutoSheet: () => void
  /** USDT in the wallet is below the daily quota: open the receive QR code */
  onAddFunds: () => void
}) {
  const evmAccount = useWallet((s) => s.evmAccount)
  const external = useExternalWallet()
  const holdings = usePortfolio((s) => s.holdings)
  const [cfg, setCfg] = useState<AutoConfig | null>(null)
  const [perDay, setPerDay] = useState('20')
  const [step, setStep] = useState<string | null>(null)
  const busy = useRef(false)
  useEffect(() => { if (open) autoConfig().then(setCfg).catch(() => setCfg(null)) }, [open])

  const canAuto = !!cfg?.enabled && !external && watchesChain(fly, 'bsc')
  const usdt = holdings.find((h) => h.chainId === 56 && sameAddr(h.mint, BSC_USDT))?.amount ?? 0

  const start = async (auto: boolean) => {
    if (busy.current) return
    const n = Number(perDay)
    if (auto && cfg) {
      const max = Math.min(cfg.maxPerDayUsd, HARD_MAX_PER_DAY)
      if (!Number.isInteger(n) || n < cfg.minPerDayUsd || n > max) return toast.error(t('每日额度在 ${min} 到 ${max} 之间', { min: cfg.minPerDayUsd, max }))
      if (!evmAccount) return toast.error(t('请先解锁钱包'))
    }
    busy.current = true
    setStep(auto ? t('正在开启…') : t('正在保存…'))
    try {
      // First set the trading mode to spot (the server requires the sprite to already be in spot mode with the current agreement version before enabling autopilot)
      let f = fly
      if (fly.mode !== 'confirm' || fly.agreementCurrent === false || !fly.agreementAt) {
        f = await api<Fly>(`/api/flies/${fly.id}/mode`, { method: 'PUT', body: JSON.stringify({ mode: 'confirm', agreement: true }) })
        onStarted(f)
      }
      if (auto && evmAccount) {
        // Autopilot is per wallet, not per sprite: if already on (another sprite enabled it), no need to sign again
        const st = await autoStatus()
        if (!st.active) await enableAutoTrade(evmAccount, n, AUTO_DAYS, (x) => setStep(x === 'authorize' ? t('正在授权钱包…') : x === 'revoke' ? t('正在作废旧授权…') : x === 'sign' ? t('正在签署交易额度…') : t('正在开启…')))
        toast.success(t('已开启自动交易'))
      } else toast.success(t('已开始。小精灵想买卖时会问你'))
      onDone()
    } catch (e) {
      if (e instanceof ForeignWalletError) { onDone(); onAutoSheet() }
      else toast.error(errorText(e, t('开启失败')))
    } finally { busy.current = false; setStep(null) }
  }

  if (!canAuto) return (
    <div className="space-y-4">
      <p className="text-[15px]">{t('小精灵想买卖时会问你。')}</p>
      <Button size="lg" className="w-full" loading={!!step} disabled={!!step} onClick={() => start(false)}>{step || t('开始')}</Button>
    </div>
  )
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-semibold">{t('每天最多用')}</span>
        <div className="mt-2 flex h-14 items-center gap-2 rounded-2xl border border-line bg-card px-4">
          <span className="text-lg text-muted">$</span>
          <input inputMode="numeric" aria-label={t('每天最多用')} value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} className="w-full bg-transparent text-2xl font-bold tabular-nums text-fg outline-none" />
          <span className="text-sm text-muted">USDT</span>
        </div>
        <span className="mt-2 flex items-center justify-between text-xs text-muted">{t('钱包余额 {usd}', { usd: fmtUsd(usdt) })}
          {/* 2026-10-05 goat: make it a small button — the old line of text was easy to miss */}
          {usdt < (Number(perDay) || 0) && <button type="button" onClick={onAddFunds} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent/15 px-3 text-xs font-semibold text-accent transition-transform active:scale-95"><Plus size={13} strokeWidth={2.5} aria-hidden="true" />{t('添加资金')}</button>}
        </span>
      </label>
      <div className="space-y-2">
        <Button size="lg" className="w-full" loading={!!step} disabled={!!step} onClick={() => start(true)}>{step || t('开启自动交易')}</Button>
        <Button variant="secondary" className="w-full" disabled={!!step} onClick={() => start(false)}>{t('每次先问我')}</Button>
      </div>
    </div>
  )
}
