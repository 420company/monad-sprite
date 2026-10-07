// 首页燃料费预警（2026-09-27 goat）：某条链上还有币但燃料费不够，卖出会失败 —— 提醒用户；
// 开了「自动补充燃料费」就直接从 BSC 上的 BNB 预存里补（同一条链 6 小时内最多自动补一次，失败不重试刷屏）。
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
const markAuto = (chainId: number) => { try { localStorage.setItem(KEY, JSON.stringify({ ...lastAuto(), [chainId]: Date.now() })) } catch { /* 无痕模式 */ } }
// 自动补充的 24 小时累计（美元）：不超过用户设的燃料预算（2026-09-28 审查 #12：冷却只限次数，不限金额）
const SPENT_KEY = '0x4.autoRefuelSpent'
const spent24h = (): { at: number; usd: number }[] => { try { return (JSON.parse(localStorage.getItem(SPENT_KEY) || '[]') as { at: number; usd: number }[]).filter((x) => Date.now() - x.at < 24 * 3600_000) } catch { return [] } }
const addSpent = (usd: number, at: number) => { try { localStorage.setItem(SPENT_KEY, JSON.stringify([...spent24h(), { at, usd }])) } catch { /* 无痕模式 */ } }
const dropSpent = (at: number) => { try { localStorage.setItem(SPENT_KEY, JSON.stringify(spent24h().filter((x) => x.at !== at))) } catch { /* 无痕模式 */ } }
// 签名之前就失败（报价失败、没路线、用户取消）：钱肯定没花出去，退回额度，30 分钟后可以再试；
// 走到签名之后才失败：交易可能已经发出去了，额度和 6 小时冷却都保留，宁可少补也不重复补（2026-09-29 Codex 复审 P1）
const RETRY_AFTER_FAIL = 30 * 60_000
const unmarkAuto = (chainId: number) => { try { localStorage.setItem(KEY, JSON.stringify({ ...lastAuto(), [chainId]: Date.now() - COOLDOWN + RETRY_AFTER_FAIL })) } catch { /* 无痕模式 */ } }

export default function GasWatch({ onOpenFuel }: { onOpenFuel: () => void }) {
  const holdings = usePortfolio((s) => s.holdings)
  const lastUpdated = usePortfolio((s) => s.lastUpdated)
  const { autoRefuel, gasReserveUsd, fuelChains } = useSettings()
  const scannedChains = usePortfolio((s) => s.scannedChains)
  const evmAccount = useWallet((s) => s.evmAccount)
  // 原生 App 里 evmAccount 一直是带闸外壳，锁着也有值；自动补充要看真签名器是否已解锁
  const keysUnlocked = useWallet((s) => s.keysUnlocked)
  const { run, busyChain, bnbUsd } = useRefuel()
  const low = lastUpdated ? lowGasChains(holdings) : []
  const running = useRef(false)
  // 各链燃料费标准按服务器实测（每 3 小时更新），拿到后重新判断一次
  const [, setRulesTick] = useState(0)
  useEffect(() => { loadGasRules().then(() => setRulesTick((x) => x + 1)) }, [])

  // 自动补：App 开着、钱包解锁时进行（锁着就跳过，不弹验证框）；BNB 不够补就只提醒
  useEffect(() => {
    if (!canAutoRefuel({ enabled: autoRefuel, hasAccount: !!evmAccount, keysUnlocked, portfolioReady: !!lastUpdated }) || running.current) return
    // 要补的链：有币却缺燃料费的链（卖出会失败），加上用户在燃料费页添加的链（专门为它预存，余额低于警戒线就补）
    // 冷却和 24 小时额度在锁里重新读一次：别的标签刚补过，这里就不会再补
    const pick = () => autoRefuelDue({ holdings, low: low.map((l) => l.chainId), fuelChains, scannedChains, bnbUsd, reserveUsd: gasReserveUsd, spentUsd: spent24h().reduce((s, x) => s + x.usd, 0), lastAuto: lastAuto(), cooldownMs: COOLDOWN })
    if (pick() === null) return
    running.current = true
    withRefuelLock(async () => {
      const due = pick()
      if (due === null) return
      const usd = gasRule(due).topUpUsd, at = Date.now()
      markAuto(due); addSpent(usd, at)   // 先占住额度和冷却，别的标签看到就不会再发
      let signing = false
      const name = chainById(due)?.name || ''
      try {
        await run(due, usd, { beforeSign: async () => { signing = true } })
        toast.success(t('已自动为 {chain} 补充燃料费', { chain: name }))
      } catch (e) {
        if (!signing) { dropSpent(at); unmarkAuto(due) }
        toast.error(t('自动补充燃料费失败：{msg}', { msg: errorText(e, '') }))
      }
    }).catch(() => { /* 浏览器的锁本身出错：这一轮不补，下次再判断 */ }).finally(() => { running.current = false })
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
