// Home gas warning (2026-09-27 goat): a chain still holds coins but is short on gas, so selling would fail — warn the user;
// With "auto gas top-up" on, top up directly from the BNB reserve on BSC (at most one auto top-up per chain per 6 hours; failures don't retry-spam).
import { useEffect, useRef, useState } from 'react'
import FuelGauge from '@/components/FuelGauge'
import { toast } from '@/components/Toast'
import { usePortfolio } from '@/store/portfolio'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { loadGasRules, BSC, gasRule, lowGasChains, autoRefuelDue, canAutoRefuel } from '@/lib/gas'
import { useRefuel } from '@/lib/useRefuel'
import { chainById } from '@/lib/chains'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { withRefuelLock } from '@/lib/refuelLock'

const COOLDOWN = 6 * 3600_000
const KEY = '0x4.autoRefuelAt'
const lastAuto = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const markAuto = (chainId: number) => { try { localStorage.setItem(KEY, JSON.stringify({ ...lastAuto(), [chainId]: Date.now() })) } catch { /* Incognito mode */ } }
// Auto top-up's rolling 24h total (USD): never exceeds the user's gas budget (2026-09-28 review #12: cooldown limits frequency, not amount)
const SPENT_KEY = '0x4.autoRefuelSpent'
const spent24h = (): { at: number; usd: number }[] => { try { return (JSON.parse(localStorage.getItem(SPENT_KEY) || '[]') as { at: number; usd: number }[]).filter((x) => Date.now() - x.at < 24 * 3600_000) } catch { return [] } }
const addSpent = (usd: number, at: number) => { try { localStorage.setItem(SPENT_KEY, JSON.stringify([...spent24h(), { at, usd }])) } catch { /* Incognito mode */ } }
const dropSpent = (at: number) => { try { localStorage.setItem(SPENT_KEY, JSON.stringify(spent24h().filter((x) => x.at !== at))) } catch { /* Incognito mode */ } }
// Failed before signing (quote failed, no route, user cancelled): no money left the wallet, so refund the quota — retry allowed after 30 minutes;
// Failed only after reaching signing: the tx may already be sent — keep the quota and the 6-hour cooldown; better to under-top-up than to double-top-up (2026-09-29 Codex review P1)
const RETRY_AFTER_FAIL = 30 * 60_000
const unmarkAuto = (chainId: number) => { try { localStorage.setItem(KEY, JSON.stringify({ ...lastAuto(), [chainId]: Date.now() - COOLDOWN + RETRY_AFTER_FAIL })) } catch { /* Incognito mode */ } }

export default function GasWatch({ onOpenFuel }: { onOpenFuel: () => void }) {
  const holdings = usePortfolio((s) => s.holdings)
  const lastUpdated = usePortfolio((s) => s.lastUpdated)
  const { autoRefuel, gasReserveUsd, fuelChains } = useSettings()
  const scannedChains = usePortfolio((s) => s.scannedChains)
  const evmAccount = useWallet((s) => s.evmAccount)
  // In the native app, evmAccount is always the gated shell — it has a value even while locked; auto top-up must check whether the real signer is unlocked
  const keysUnlocked = useWallet((s) => s.keysUnlocked)
  const { run, busyChain, bnbUsd } = useRefuel()
  const low = lastUpdated ? lowGasChains(holdings) : []
  const running = useRef(false)
  // Per-chain gas standards follow server measurements (updated every 3 hours); re-evaluate once they arrive
  const [, setRulesTick] = useState(0)
  useEffect(() => { loadGasRules().then(() => setRulesTick((x) => x + 1)) }, [])

  // Auto top-up: runs while the app is open and the wallet unlocked (skipped when locked, no auth prompt); if BNB is too low to top up, just notify
  useEffect(() => {
    if (!canAutoRefuel({ enabled: autoRefuel, hasAccount: !!evmAccount, keysUnlocked, portfolioReady: !!lastUpdated }) || running.current) return
    // Chains to top up: chains holding coins but short on gas (selling would fail), plus chains the user added on the gas page (pre-stored specifically for them — top up when the balance drops below the warning line)
    // Re-read the cooldown and 24h quota inside the lock: if another tab just topped up, this one won't top up again
    const pick = () => autoRefuelDue({ holdings, low: low.map((l) => l.chainId), fuelChains, scannedChains, bnbUsd, reserveUsd: gasReserveUsd, spentUsd: spent24h().reduce((s, x) => s + x.usd, 0), lastAuto: lastAuto(), cooldownMs: COOLDOWN })
    if (pick() === null) return
    running.current = true
    withRefuelLock(async () => {
      const due = pick()
      if (due === null) return
      const usd = gasRule(due).topUpUsd, at = Date.now()
      markAuto(due); addSpent(usd, at)   // Occupy the quota and cooldown first — other tabs seeing it won't send again
      let signing = false
      const name = chainById(due)?.name || ''
      try {
        await run(due, usd, { beforeSign: async () => { signing = true } })
        toast.success(t('已自动为 {chain} 补充燃料费', { chain: name }))
      } catch (e) {
        if (!signing) { dropSpent(at); unmarkAuto(due) }
        toast.error(t('自动补充燃料费失败：{msg}', { msg: errorText(e, '') }))
      }
    }).catch(() => { /* The browser's lock itself errored: skip this round's top-up, evaluate again next time */ }).finally(() => { running.current = false })
  }, [autoRefuel, evmAccount, keysUnlocked, lastUpdated]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!low.length) return null
  return (
    <div className="page-gutter mt-4 space-y-2">
      {low.slice(0, 3).map((l) => {
        const name = chainById(l.chainId)?.name || ''
        const busy = busyChain === l.chainId
        return (
          <div key={l.chainId} className="glass-lite flex items-center gap-3 rounded-[22px] !border-warning/30 px-4 py-3 text-[13px]">
            <FuelGauge level="low" size={24} className="text-muted" />
            <span className="min-w-0 flex-1"><span className="block font-medium text-warning">{t('{chain} 燃料费不足', { chain: name })}</span><span className="mt-0.5 block text-xs text-muted">{t('这条链上还有约 ${usd} 的币，但 {symbol} 燃料费不到 ${min}，卖出时会失败。', { usd: l.holdingsUsd.toFixed(0), symbol: l.symbol, min: l.minUsd })}</span></span>
            {l.chainId === BSC
              ? <button onClick={onOpenFuel} className="shrink-0 text-xs font-semibold text-accent">{t('去补充')}</button>
              : <button disabled={busy || !evmAccount} onClick={() => run(l.chainId, gasRule(l.chainId).topUpUsd).then(() => toast.success(t('已补充，几秒后到账'))).catch((e) => toast.error(errorText(e, t('补充失败'))))} className="shrink-0 text-xs font-semibold text-accent disabled:opacity-50">{busy ? t('补充中…') : t('补充')}</button>}
          </div>
        )
      })}
    </div>
  )
}
