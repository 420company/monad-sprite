// 交易方式面板里「现货交易」那一页的开始交易（2026-10-05 goat：「启动交易的模式太复杂了用户看不懂」「文字一定要简单」）。
// 原来要先选现货 / 合约、勾一大段协议、激活，再弹全自动面板填额度和天数，四步；现在只问每天最多用多少，一个按钮开始：
//   · 能开自动交易（服务器开放、这只看 BNB Chain 的币、用的是 0x4 钱包）：「开启自动交易」= 选现货 + 开自动交易（钱包签一次，有效期 30 天）；
//     下面「每次先问我」= 只选现货不开自动（和自动交易是同一类，所以放在它下面；合约在面板顶上的标签里，goat：两个不是一类别并排放）
//   · 开不了：只有「开始」，小精灵想买卖时问主人
// 协议那行由外面的交易方式面板统一放（点按钮即同意）。
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
  /** 交易方式已经存成现货（不要再弹全自动面板：主人已经在这里选过了） */
  onStarted: (f: Fly) => void
  /** 全部完成，关掉面板 */
  onDone: () => void
  /** 自动交易开不下来、要用完整面板处理（钱包被别家升级成智能账户等） */
  onAutoSheet: () => void
  /** 钱包里的 USDT 不够每天的额度：打开收款二维码 */
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
      // 先把交易方式定成现货（服务器要求开自动交易前已有现货模式的小精灵、协议是当前版本）
      let f = fly
      if (fly.mode !== 'confirm' || fly.agreementCurrent === false || !fly.agreementAt) {
        f = await api<Fly>(`/api/flies/${fly.id}/mode`, { method: 'PUT', body: JSON.stringify({ mode: 'confirm', agreement: true }) })
        onStarted(f)
      }
      if (auto && evmAccount) {
        // 自动交易按钱包算，不按小精灵：已经开着（别的小精灵开过）就不用再签
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
          {/* 2026-10-05 goat：做成小按钮，原来一行字不明显 */}
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
