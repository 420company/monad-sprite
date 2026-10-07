// Spot autopilot (plan B, 2026-09-27): once enabled, the sprite's buys/sells on BNB Chain no longer ask per-order confirmation — it executes on its own.
// Enabling only needs signatures (2 quota delegations + wallet authorization), with the server covering gas; funds stay in the user's own wallet day-to-day, each trade drawing within its quota (lib/autoTrade.ts).
// Two entries: the sprite detail's trading settings, and "Me → Account & Security" (the latter depends on no sprite, guaranteeing pause / revoke is always available — round 6 #15)
import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { useWallet } from '@/store/wallet'
import { autoConfig, autoStatus, DAY_CHOICES, enableAutoTrade, ForeignWalletError, HARD_MAX_PER_DAY, hasOnchainAuthorization, revokeAutoTrade, stopAutoTrade, type AutoConfig, type AutoStatus } from '@/lib/autoTrade'
import { locale, t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { Ox4OnlyCard, useExternalWallet } from '@/desktop/Ox4Only'


export default function AutoTradeSheet(props: { open: boolean; onClose: () => void; onChanged?: (s: AutoStatus) => void }) {
  // Web with an external wallet connected: sprite autopilot is a 0x4 Wallet exclusive (2026-09-30 goat) — the sheet only shows the exclusivity card
  const external = useExternalWallet()
  if (external) return <Sheet open={props.open} onClose={props.onClose} title={t('自动交易')}><Ox4OnlyCard feature="auto" compact /></Sheet>
  return <AutoTradeBody {...props} />
}

function AutoTradeBody({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: (s: AutoStatus) => void }) {
  const evmAccount = useWallet((s) => s.evmAccount)
  const [cfg, setCfg] = useState<AutoConfig | null | 'error'>(null)
  // An authorization is still on-chain: give the revoke entry regardless of whether the server is on or the API works (round 2 review)
  const [onchain, setOnchain] = useState(false)
  const [st, setSt] = useState<AutoStatus | null>(null)
  const [perDay, setPerDay] = useState('100')
  const [days, setDays] = useState(30)
  const [step, setStep] = useState<string | null>(null)
  // Already upgraded to a smart account by another wallet: let the user see clearly before deciding whether to overwrite (round 6 #17)
  const [foreign, setForeign] = useState<string | null>(null)
  // Sync lock: mark busy before any await — double-tapping won't run it twice (round 6 #18)
  const busy = useRef(false)
  useEffect(() => {
    if (!open) return
    setForeign(null)
    // The server API and chain reads are independent: a dead server doesn't affect the revoke entry (round 6 #15)
    autoConfig().then(setCfg).catch(() => setCfg('error'))
    autoStatus().then(setSt).catch(() => setSt(null))
    if (evmAccount) hasOnchainAuthorization(evmAccount.address).then(setOnchain)
  }, [open, evmAccount])

  const enable = async (replaceExisting = false) => {
    if (busy.current) return
    const n = Number(perDay)
    if (!cfg || cfg === 'error') return
    const max = Math.min(cfg.maxPerDayUsd, HARD_MAX_PER_DAY)
    if (!Number.isInteger(n) || n < cfg.minPerDayUsd || n > max) return toast.error(t('每日额度在 ${min} 到 ${max} 之间', { min: cfg.minPerDayUsd, max }))
    if (!evmAccount) return toast.error(t('请先解锁钱包'))
    busy.current = true
    setStep(t('正在开启…'))
    try {
      const s = await enableAutoTrade(evmAccount, n, days, (x) => setStep(x === 'authorize' ? t('正在授权钱包…') : x === 'revoke' ? t('正在作废旧授权…') : x === 'sign' ? t('正在签署交易额度…') : t('正在开启…')), { replaceExisting })
      setForeign(null); setSt(s); onChanged?.(s); toast.success(t('已开启全自动交易'))
    } catch (e) {
      if (e instanceof ForeignWalletError) setForeign(e.impl)
      else toast.error(errorText(e, t('开启失败')))
      // The server may have actually enabled it (response lost): refresh the status instead of leaving the UI stuck on "not enabled" (9th review round)
      autoStatus().then((x) => { setSt(x); onChanged?.(x) }).catch(() => {})
    } finally { busy.current = false; setStep(null) }
  }
  const stop = async () => {
    if (busy.current) return
    try {
      const s = await stopAutoTrade(); setSt(s); onChanged?.(s)
      toast.success(s.inflight ? t('已暂停。有 {n} 笔已经发出的交易可能仍会完成', { n: s.inflight }) : t('已暂停全自动交易'))
    } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  // Revoke on-chain approvals: voids all allowances (sends its own tx, costs a little BNB gas), kept separate from "pause" (review #4)
  const revoke = async () => {
    if (busy.current) return
    if (!evmAccount) return toast.error(t('请先解锁钱包'))
    busy.current = true
    setStep(t('正在撤销链上权限…'))
    try {
      const s = await revokeAutoTrade(evmAccount)
      if (s) { setSt(s); onChanged?.(s) }
      toast.success(t('链上权限已全部作废'))
    } catch (e) { toast.error(errorText(e, t('操作失败'))) }
    finally { busy.current = false; setStep(null) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('自动交易')}>
      <p className="text-sm leading-relaxed text-muted">{t('开启后小精灵将全自动执行设定任务。')}</p>
      <div className="mt-3 space-y-2 rounded-2xl bg-card2 p-4 text-[13px] leading-relaxed">
        <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-up" aria-hidden="true" />{t('安全规则')}</div>
        {/* 2026-09-29 goat: the original five paragraphs were too long and read like developer docs — trimmed to four rules + one risk note (risks must be stated, but stating them clearly is enough) */}
        <p>{t('只通过 0x4 交易合约买卖，所得资金只会回到你的钱包。')}</p>
        <p>{t('买入只用 USDT，每天不超过你设定的额度。')}</p>
        <p>{t('只卖出小精灵买入的数量。')}</p>
        <p>{t('到期自动失效，可以随时暂停或撤销授权。')}</p>
        <p className="text-muted">{t('自动交易不保证成交价格。行情波动或服务异常都可能造成亏损，累计亏损可能超过单日额度。')}</p>
      </div>

      {/* During a ban / when the authorization was replaced by another wallet: tell the user truthfully (round 7 review) */}
      {st?.banned ? <p className="mt-4 rounded-2xl bg-card p-4 text-sm text-muted">{t('账号受限期间，全自动交易不会执行。你仍然可以暂停，或者撤销链上权限。')}</p> : null}
      {st?.replaced ? <p className="mt-4 rounded-2xl bg-card p-4 text-sm text-down">{t('该钱包在 BNB Chain 上的授权已被其他钱包替换，全自动交易已停止。')}</p> : null}
      {/* The server disables it once conditions no longer hold (round 11 review #4 #5) */}
      {st?.revoked && !st.active ? <p className="mt-4 rounded-2xl bg-card p-4 text-sm text-muted">{t('该钱包在 BNB Chain 上的授权已失效，全自动交易已停止，可重新开启。')}</p> : null}
      {st?.evmChanged && !st.active ? <p className="mt-4 rounded-2xl bg-card p-4 text-sm text-muted">{t('账号绑定的钱包已更换，原全自动交易已停止，请用当前钱包重新开启。')}</p> : null}
      {st?.outdated && !st.active ? <p className="mt-4 rounded-2xl bg-card p-4 text-sm text-muted">{t('全自动交易授权需要更新，请重新开启。')}</p> : null}
      {st?.banned && !st.stopped && st.until ? <Button variant="secondary" className="mt-3 w-full" disabled={!!step} onClick={stop}>{t('暂停')}</Button> : null}
      {!cfg ? (
        <div className="mt-4 space-y-3">
          <div className="skeleton h-24" />
          {/* The server hasn't responded yet doesn't block revoking: show the button while an authorization is still on-chain (round 7 review #15) */}
          {onchain ? <Button variant="danger" className="w-full" loading={!!step} disabled={!!step} onClick={revoke}>{t('撤销链上权限')}</Button> : null}
        </div>
      ) : cfg === 'error' || !cfg.enabled ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-2xl bg-card p-4 text-sm text-muted">{cfg === 'error' ? t('暂时无法连接服务，请稍后再试。') : t('全自动交易即将开放，敬请期待。')}</p>
          {onchain ? <Button variant="danger" className="w-full" loading={!!step} disabled={!!step} onClick={revoke}>{t('撤销链上权限')}</Button> : null}
        </div>
      ) : st?.active ? (
        <div className="mt-4 rounded-2xl bg-card p-4">
          <div className="text-[15px] font-semibold text-up">{t('已开启')}</div>
          <div className="mt-1 text-sm text-muted">{t('每日额度 ${usd}，{date} 到期', { usd: st.perDayUsd, date: st.until ? new Date(st.until).toLocaleDateString(locale()) : '--' })}</div>
          {st.inflight ? <div className="mt-1 text-xs text-muted">{t('有 {n} 笔交易正在执行', { n: st.inflight })}</div> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={!!step} onClick={stop}>{t('暂停')}</Button>
            <Button variant="danger" loading={!!step} disabled={!!step} onClick={revoke}>{t('撤销链上权限')}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-muted">{t('每日额度（美元）')}
            <div className="mt-1 flex h-11 items-center gap-1 rounded-xl border border-line bg-card px-3"><span className="text-sm text-muted">$</span>
              <input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/[^\d]/g, ''))} className="w-full bg-transparent text-base tabular-nums text-fg outline-none" />
            </div>
          </label>
          <div>
            <div className="text-xs text-muted">{t('有效期')}</div>
            <div className="mt-1 grid grid-cols-3 gap-2">{DAY_CHOICES.map((d) => <button key={d} onClick={() => setDays(d)} className={`min-h-10 rounded-xl text-sm font-semibold ${days === d ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{t('{n} 天', { n: d })}</button>)}</div>
          </div>
          <p className="text-xs leading-relaxed text-muted">{t('开启需要授权，仅使用 BNB Chain 上的 USDT。再次开启需少量 BNB 作为燃料费。')}</p>
          {onchain || (st && !st.active && st.until) ? <Button variant="ghost" className="w-full text-muted" loading={!!step} disabled={!!step} onClick={revoke}>{t('撤销链上权限')}</Button> : null}
          {/* Not eligible (no confirm-mode sprite, agreement not updated, etc.): state the reason directly, no enable button */}
          {st && st.eligible === false ? <p className="rounded-2xl bg-card p-4 text-sm text-muted">{st.whyNot ? t(st.whyNot) : t('暂时不能开启全自动')}</p> : foreign ? (
            <div className="space-y-3 rounded-2xl border border-down/40 bg-card p-4 text-[13px] leading-relaxed">
              <p>{t('这个地址在 BNB Chain 上已被别的钱包升级为智能账户（{impl}）。开启全自动会把它换成全自动需要的实现，那个钱包在 BNB Chain 上的智能账户功能会失效；它以后改回去，全自动也会停止。', { impl: `${foreign.slice(0, 6)}…${foreign.slice(-4)}` })}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={!!step} onClick={() => setForeign(null)}>{t('取消')}</Button>
                <Button variant="danger" loading={!!step} disabled={!!step} onClick={() => enable(true)}>{t('继续开启')}</Button>
              </div>
            </div>
          ) : <Button size="lg" className="w-full" loading={!!step} disabled={!!step} onClick={() => enable()}>{step || t('开启自动交易')}</Button>}
        </div>
      )}
    </Sheet>
  )
}
