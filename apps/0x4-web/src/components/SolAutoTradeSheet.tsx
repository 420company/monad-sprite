// 现货全自动 · Solana（2026-10-04）：和 BNB Chain 版（AutoTradeSheet）同一个样子。区别：
//   · 开启只要用 Solana 钱包签一次（同一笔里授权 USDC、写上 0x4 账号标记），服务器读链核对后生效
//   · 买到的币放在只属于这位用户的链上保险箱，下面列出来，随时可以「提回钱包」（关闭了也能提）
import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { useSocial } from '@/store/social'
import { enableSolAuto, solAutoConfig, solAutoStatus, stopSolAuto, withdrawSolVault, type SolAutoConfig, type SolAutoStatus, type SolVault } from '@/lib/solAuto'
import { locale, t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { Ox4OnlyCard, useExternalWallet } from '@/desktop/Ox4Only'

const DAY_CHOICES = [7, 30, 90] as const

export default function SolAutoTradeSheet(props: { open: boolean; onClose: () => void; onChanged?: (s: SolAutoStatus) => void }) {
  // 网页版连的是外部钱包：没有 Solana 钱包，全自动是 0x4 Wallet 专属（和 BNB Chain 版一样）
  const external = useExternalWallet()
  if (external) return <Sheet open={props.open} onClose={props.onClose} title={t('全自动交易')}><Ox4OnlyCard feature="auto" compact /></Sheet>
  return <Body {...props} />
}

function fmtAmount(v: SolVault): string {
  const n = Number(BigInt(v.amount)) / 10 ** v.decimals
  return n.toLocaleString(locale(), { maximumFractionDigits: n >= 1 ? 4 : 8 })
}

function Body({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: (s: SolAutoStatus) => void }) {
  const wallet = useWallet((s) => s.wallet)
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const account = useSocial((s) => s.me?.address)
  const [cfg, setCfg] = useState<SolAutoConfig | null | 'error'>(null)
  const [st, setSt] = useState<SolAutoStatus | null>(null)
  const [perDay, setPerDay] = useState('100')
  const [days, setDays] = useState<number>(30)
  const [step, setStep] = useState<string | null>(null)
  const busy = useRef(false)
  const reload = () => solAutoStatus().then((x) => { setSt(x); onChanged?.(x) }).catch(() => setSt(null))
  useEffect(() => {
    if (!open) return
    solAutoConfig().then(setCfg).catch(() => setCfg('error'))
    void reload()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    if (busy.current) return
    busy.current = true
    setStep(label)
    try { await fn(); toast.success(ok) } catch (e) { toast.error(errorText(e, t('操作失败'))) } finally {
      busy.current = false; setStep(null)
      void reload()   // 不管成败都刷新：链上可能已经成了、只是响应丢了
    }
  }
  const enable = () => {
    if (!cfg || cfg === 'error') return
    const n = Number(perDay)
    if (!Number.isInteger(n) || n < 1 || n > cfg.maxPerDayUsd) return toast.error(t('每日额度在 ${min} 到 ${max} 之间', { min: 1, max: cfg.maxPerDayUsd }))
    if (!wallet) return toast.error(t('请先解锁钱包'))
    if (!account) return toast.error(t('请先登录'))
    void run(t('正在开启…'), () => enableSolAuto({ rpcUrl, wallet, account, perDayUsd: n, days }), t('已开启全自动交易'))
  }
  const stop = () => void run(t('正在关闭…'), () => stopSolAuto({ rpcUrl, wallet }), t('已关闭全自动交易'))
  const withdraw = (v: SolVault) => {
    if (!wallet) return toast.error(t('请先解锁钱包'))
    void run(t('正在提回钱包…'), () => withdrawSolVault({ rpcUrl, wallet, vault: v, all: true }), t('已提回钱包'))
  }
  const vaults = st?.vaults || []

  return (
    <Sheet open={open} onClose={onClose} title={t('全自动交易')}>
      <p className="text-sm leading-relaxed text-muted">{t('开启后小精灵将全自动执行设定任务。')}</p>
      <div className="mt-3 space-y-2 rounded-2xl bg-card2 p-4 text-[13px] leading-relaxed">
        <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-up" aria-hidden="true" />{t('安全规则')}</div>
        <p>{t('只通过 0x4 交易程序买卖，卖出所得只会回到你的钱包。')}</p>
        <p>{t('买入只用 USDC，每天不超过你设定的额度。')}</p>
        <p>{t('买到的币放在只属于你的链上保险箱，随时可以提回钱包。')}</p>
        <p>{t('到期自动失效，可以随时关闭。')}</p>
        <p className="text-muted">{t('自动交易不保证成交价格。行情波动或服务异常都可能造成亏损，累计亏损可能超过单日额度。')}</p>
      </div>

      {!cfg ? <div className="mt-4 skeleton h-24" />
        : cfg === 'error' || !cfg.enabled ? <p className="mt-4 rounded-2xl bg-card p-4 text-sm text-muted">{cfg === 'error' ? t('暂时无法连接服务，请稍后再试。') : t('全自动交易即将开放，敬请期待。')}</p>
        : st?.active ? (
          <div className="mt-4 rounded-2xl bg-card p-4">
            <div className="text-[15px] font-semibold text-up">{t('已开启')}</div>
            <div className="mt-1 text-sm text-muted">{t('每日额度 ${usd}，{date} 到期', { usd: st.perDayUsd ?? 0, date: st.until ? new Date(st.until).toLocaleDateString(locale()) : '--' })}</div>
            <Button variant="secondary" className="mt-3 w-full" loading={!!step} disabled={!!step} onClick={stop}>{t('关闭全自动')}</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {st?.stopReason && st.stopReason !== 'user' ? <p className="rounded-2xl bg-card p-4 text-sm text-muted">{t('全自动已停止：{why}。可以重新开启。', { why: t(st.stopReason) })}</p> : null}
            <label className="block text-xs text-muted">{t('每日额度（美元）')}
              <div className="mt-1 flex h-11 items-center gap-1 rounded-xl border border-line bg-card px-3"><span className="text-sm text-muted">$</span>
                <input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/[^\d]/g, ''))} className="w-full bg-transparent text-base tabular-nums text-fg outline-none" />
              </div>
            </label>
            <div>
              <div className="text-xs text-muted">{t('有效期')}</div>
              <div className="mt-1 grid grid-cols-3 gap-2">{DAY_CHOICES.map((d) => <button key={d} onClick={() => setDays(d)} className={`min-h-10 rounded-xl text-sm font-semibold ${days === d ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{t('{n} 天', { n: d })}</button>)}</div>
            </div>
            <p className="text-xs leading-relaxed text-muted">{t('开启需要用 Solana 钱包签名一次，只使用 Solana 上的 USDC，需要少量 SOL 作为网络费。')}</p>
            <Button size="lg" className="w-full" loading={!!step} disabled={!!step} onClick={enable}>{step || t('开启全自动交易')}</Button>
          </div>
        )}

      {/* 保险箱：开没开都显示，关闭以后也能提 */}
      {vaults.length > 0 && (
        <div className="mt-4 rounded-2xl bg-card p-4" data-testid="sol-vaults">
          <div className="text-sm font-semibold">{t('保险箱')}</div>
          <p className="mt-0.5 text-xs text-muted">{t('小精灵全自动买到的币，只有你能提走。')}</p>
          <ul className="mt-2 divide-y divide-line/60">
            {vaults.map((v) => (
              <li key={v.mint} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{v.symbol || `${v.mint.slice(0, 4)}…${v.mint.slice(-4)}`}</div><div className="text-xs tabular-nums text-muted">{fmtAmount(v)}</div></div>
                <Button size="sm" variant="secondary" disabled={!!step} onClick={() => withdraw(v)}>{t('提回钱包')}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}
