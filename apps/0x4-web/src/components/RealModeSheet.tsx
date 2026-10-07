// Trading mode (no paper trading; must pick one after adoption or the worker dispatches nothing):
//  confirm = spot mode (UI calls it "spot mode" since 2026-09-28, stored value stays confirm): the fly proposes, the owner confirms orders on the phone with their own wallet; auto-executes on BNB Chain once full-auto is on
//  perp    = BSC perps (Aster) API-key contract: principal stays in the user's own perp account, the key can trade but not withdraw, leverage ≤ 100x (since 2026-09-27, was 3x)
import { useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { PERP_ENABLED } from '@/lib/features'
import Button from './Button'
import Sheet from './Sheet'
import { Input, Label } from './Field'
import { toast } from './Toast'
import SpotStart from './SpotStart'
import ReceiveSheet from './ReceiveSheet'
import { usePortfolio } from '@/store/portfolio'
import { api, type Fly, type FlyMode } from '@/lib/social'
import { approveAgent } from '@/lib/aster'
import { useWallet } from '@/store/wallet'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export const AGREEMENT = [
  '这是一个生物脑模型的交易实验，不保证盈利，任何模式都可能亏损投入的资金。',
  '现货模式下，没有开启全自动时每一笔都由我签名；开启全自动后，BNB Chain 上的买卖按我设定的每日额度自动执行。平台不保管我的资产；合约模式下资金在我自己的合约账户，我授权的交易密钥不能提币。',
  '本功能不构成投资建议，盈亏自负。',
]
const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
const PRESETS = [1, 3, 5, 10, 20, 50, 100]

export default function RealModeSheet({ open, onClose, fly, onSaved, onAutoSheet }: {
  open: boolean; onClose: () => void; fly: Fly
  /** started = launched directly from the "spot trading" page (already chose auto / ask-me-each-time — don't pop the full-auto panel again) */
  onSaved: (f: Fly, o?: { started?: boolean }) => void
  /** Open it when auto-trading needs the full panel */
  onAutoSheet: () => void
}) {
  const [mode, setMode] = useState<FlyMode>(fly.mode === 'pending' ? 'confirm' : fly.mode)
  const { evmAccount, evmAddress, address } = useWallet()
  const refreshPortfolio = usePortfolio((s) => s.refresh)
  // Collapse this layer while "add funds" shows the receive code; come back when closed
  const [receiving, setReceiving] = useState(false)
  const [agentKey, setAgentKey] = useState('')
  // The main account IS the user's own wallet address — no reason to make them type it
  const [mainAddress, setMainAddress] = useState(fly.perp?.mainAddress || evmAddress || '')
  const [authorizing, setAuthorizing] = useState(false)
  /** Already authorized, or just authorized this time */
  const authorized = !!fly.perp || !!agentKey
  const [leverage, setLeverage] = useState(fly.leverage || 1)
  // Custom multiplier gets its own input (2026-09-28 goat: it used to look like the preset buttons). In-progress text is kept locally; clearing and retyping isn't snapped back to 1
  const [custom, setCustom] = useState(PRESETS.includes(fly.leverage || 1) ? '' : String(fly.leverage))
  const [margin, setMargin] = useState(String(fly.marginUsd || 50))
  const [busy, setBusy] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  useEffect(() => { if (open) { setReceiving(false); setMode(fly.mode === 'pending' || (!PERP_ENABLED && fly.mode === 'perp') ? 'confirm' : fly.mode); setShowTerms(false); setMainAddress(fly.perp?.mainAddress || evmAddress || ''); setLeverage(fly.leverage || 1); setCustom(PRESETS.includes(fly.leverage || 1) ? '' : String(fly.leverage)); setMargin(String(fly.marginUsd || 50)); setAgentKey('') } }, [open, fly, evmAddress])
  const onCustom = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 3)
    const n = Number(digits)
    if (!digits) { setCustom(''); return }
    const v = Math.max(1, Math.min(100, n))
    setCustom(String(n > 100 ? 100 : digits.replace(/^0+(?=\d)/, '')))
    setLeverage(v)
  }
  // On blur: empty or 0 reverts to the current multiplier (clears if it's a preset, so the preset button highlights)
  const onCustomBlur = () => setCustom(PRESETS.includes(leverage) ? '' : String(leverage))
  const customOn = !PRESETS.includes(leverage) || custom !== ''
  const marginNum = Math.min(1_000_000, Number(margin))

  /** One-tap authorize: generate an agent key locally → main wallet signs approveAgent once → stored into the fly.
   *  The private key is never displayed or persisted; it lives in memory only until submitted. */
  const authorize = async () => {
    if (!evmAccount) return toast.error(t('钱包已锁定'))
    setAuthorizing(true)
    try {
      const { agentKey: key } = await approveAgent(evmAccount, `fly-${fly.id.slice(0, 8)}`)
      setAgentKey(key)
      setMainAddress(evmAddress || '')
      toast.success(t('全自动交易授权成功'))
    } catch (e) {
      toast.error(errorText(e, t('授权失败')))
    } finally { setAuthorizing(false) }
  }
  const save = async () => {
    if (mode === 'perp' && !authorized) return toast.error(t('先用钱包授权一把代理密钥'))
    setBusy(true)
    try {
      const f = await api<Fly>(`/api/flies/${fly.id}/mode`, { method: 'PUT', body: JSON.stringify({ mode, agreement: true, perp: mode === 'perp' ? { agentKey: agentKey.trim() || undefined, mainAddress: mainAddress.trim(), leverage, marginUsd: Number(margin) } : undefined }) })
      toast.success(mode === 'confirm' ? t('已保存') : t('已开启合约交易。下一步：在「合约」页存入 USDT')); onSaved(f); onClose()
    } catch (e) { toast.error(errorText(e, t('保存失败'))) } finally { setBusy(false) }
  }
  // 2026-09-28 goat: the two modes show buttons only, no descriptions; a fixed risk line under leverage; custom multiplier as an obvious input; margin and position value side by side under margin
  return (
    <>
    <Sheet open={open && !receiving} onClose={onClose} title={fly.mode === 'pending' ? t('开始交易') : t('交易方式')}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line/70 bg-card p-1" role="radiogroup" aria-label={t('交易方式')}>
          {([['confirm', '现货交易'], ['perp', '合约交易']] as const).filter(([k]) => PERP_ENABLED || k !== 'perp').map(([k, title]) => (
            <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`min-h-12 rounded-xl text-[15px] font-semibold transition-colors ${mode === k ? 'bg-accent text-bg shadow-sm' : 'text-muted active:bg-card2'}`}>{t(title)}</button>
          ))}
        </div>
        {mode === 'perp' && (
          <div className="space-y-6 rounded-2xl border border-line/70 bg-card p-4">
            <div>
              <Label>{t('授权小精灵下单')}</Label>
              {authorized ? (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-up/10 py-1.5 pl-3 pr-1.5 text-sm text-up">
                  <span className="flex items-center gap-1.5 font-semibold"><Check size={16} aria-hidden="true" />{t('已授权')}</span>
                  <Button size="sm" variant="secondary" loading={authorizing} onClick={authorize}>{t('重新授权')}</Button>
                </div>
              ) : (
                <Button variant="secondary" className="w-full" loading={authorizing} onClick={authorize}>{t('确认交易授权')}</Button>
              )}
            </div>
            {/* Leverage 1–100x (set by goat 2026-09-27). Never above the exchange's cap for the coin */}
            <div role="group" aria-labelledby="fly-lev-label">
              <div className="mb-2 flex items-baseline justify-between"><span id="fly-lev-label" className="ui-label mb-0">{t('杠杆')}</span><span className="text-[15px] font-bold tabular-nums">{leverage}x</span></div>
              <div className="grid grid-cols-7 gap-1">
                {PRESETS.map((l) => <button key={l} aria-pressed={!customOn && leverage === l} onClick={() => { setLeverage(l); setCustom('') }} className={`min-h-10 rounded-lg text-[13px] font-semibold tabular-nums transition-colors ${!customOn && leverage === l ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>{l}x</button>)}
              </div>
              <label className={`mt-2 flex min-h-12 items-center gap-3 rounded-xl border px-3 transition-colors ${customOn ? 'border-accent bg-accent/10' : 'border-dashed border-line'}`}>
                <span className="text-sm text-muted">{t('自定义倍数')}</span>
                <span className="ml-auto flex items-center gap-1">
                  <input aria-label={t('自定义杠杆倍数')} inputMode="numeric" placeholder="1~100" value={custom} onChange={(e) => onCustom(e.target.value)} onBlur={onCustomBlur} className="w-16 bg-transparent text-right text-base font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted/60" />
                  <span className="text-sm font-semibold text-muted">x</span>
                </span>
              </label>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><AlertTriangle size={13} className="shrink-0" aria-hidden="true" />{t('高倍数杠杆可能会提高仓位清算风险')}</p>
            </div>
            <div><Label htmlFor="fly-margin">{t('单次保证金（最少 10 USDT）')}</Label><Input id="fly-margin" className="text-base" type="number" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
              {/* Fill in the actual margin committed, not the position; position value = margin × leverage (2026-09-27 goat) */}
              {marginNum >= 10 && (
                <dl className="mt-2 grid grid-cols-2 overflow-hidden rounded-xl bg-card2 text-center">
                  <div className="px-3 py-2.5"><dt className="text-[11px] text-muted">{t('保证金')}</dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{fmtNum(marginNum)} <span className="text-xs font-normal text-muted">USDT</span></dd></div>
                  <div className="border-l border-line/70 px-3 py-2.5"><dt className="text-[11px] text-muted">{t('仓位价值')}</dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{fmtNum(marginNum * leverage)} <span className="text-xs font-normal text-muted">USDT</span></dd></div>
                </dl>
              )}
            </div>
          </div>
        )}
        {/* Spot trading: not on spot yet (just adopted / switching from perps) — start right here: daily quota + enable auto-trading / ask me each time (2026-10-05 goat) */}
        {mode === 'confirm' && fly.mode !== 'confirm' && <SpotStart open={open} fly={fly} onStarted={(f) => onSaved(f, { started: true })} onDone={onClose} onAutoSheet={onAutoSheet} onAddFunds={() => setReceiving(true)} />}
        {mode === 'confirm' && fly.mode === 'confirm' && <p className="text-sm text-muted">{t('小精灵想买卖时会问你，开了自动交易就自动买卖。')}</p>}
        {(mode === 'perp' || fly.mode === 'confirm') && <Button size="lg" className="w-full" loading={busy} onClick={save}>{fly.mode === 'pending' ? t('开始') : t('保存')}</Button>}
        {/* 2026-10-05 goat "keep the words simple": the agreement isn't shown in full — tap "trading agreement" to expand; tapping a button counts as consent */}
        <p className="-mt-2 text-center text-xs text-muted">{t('开启即同意')}<button type="button" className="text-accent underline-offset-2 hover:underline" aria-expanded={showTerms} onClick={() => setShowTerms((v) => !v)}>{t('交易协议')}</button></p>
        {showTerms && <ol className="list-decimal space-y-1 rounded-xl bg-card2 py-3 pl-8 pr-4 text-xs leading-relaxed text-muted">{AGREEMENT.map((l, i) => <li key={i}>{t(l)}</li>)}</ol>}
      </div>
    </Sheet>
    <ReceiveSheet open={open && receiving} onClose={() => { setReceiving(false); void refreshPortfolio() }} address={address} evmAddress={evmAddress} initialNet="evm" />
    </>
  )
}
