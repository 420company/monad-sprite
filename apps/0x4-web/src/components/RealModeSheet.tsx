// 交易方式（没有纸面；领养后必须二选一，否则 worker 不派单）：
//  confirm = 现货模式（2026-09-28 起界面叫「现货模式」，存储值仍是 confirm）：果蝇提案，主人在手机上用自己的钱包确认下单；开了全自动后 BNB Chain 上自动执行
//  perp    = BSC 永续（Aster）代理密钥合约：本金留在用户自己的合约账户，密钥只能交易不能提币，杠杆 ≤ 100 倍（2026-09-27 起，原 3 倍）
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
  /** started = 在「现货交易」页里直接开始的（已经选过自动 / 每次先问我，别再弹全自动面板） */
  onSaved: (f: Fly, o?: { started?: boolean }) => void
  /** 自动交易要用完整面板处理时打开它 */
  onAutoSheet: () => void
}) {
  const [mode, setMode] = useState<FlyMode>(fly.mode === 'pending' ? 'confirm' : fly.mode)
  const { evmAccount, evmAddress, address } = useWallet()
  const refreshPortfolio = usePortfolio((s) => s.refresh)
  // 「添加资金」看收款码时先把这一层收起来，关掉再回来
  const [receiving, setReceiving] = useState(false)
  const [agentKey, setAgentKey] = useState('')
  // 主账户就是用户自己的钱包地址，没有理由让他手打一遍
  const [mainAddress, setMainAddress] = useState(fly.perp?.mainAddress || evmAddress || '')
  const [authorizing, setAuthorizing] = useState(false)
  /** 已经授权过、或这次刚授权完 */
  const authorized = !!fly.perp || !!agentKey
  const [leverage, setLeverage] = useState(fly.leverage || 1)
  // 自定义倍数单独一个输入框（2026-09-28 goat：原来和预设按钮长得一样，分不清）。输入过程中的文字自己存，清空再输入不会被立刻改回 1
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
  // 离开输入框：空着或是 0 就回到当前倍数（是预设就清空，让预设按钮高亮）
  const onCustomBlur = () => setCustom(PRESETS.includes(leverage) ? '' : String(leverage))
  const customOn = !PRESETS.includes(leverage) || custom !== ''
  const marginNum = Math.min(1_000_000, Number(margin))

  /** 一键授权：本地生成一把 agent 密钥 → 主钱包签一次 approveAgent → 存进果蝇。
   *  私钥不显示、不落地，只在内存里待到提交为止。 */
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
  // 2026-09-28 goat：两个模式只放按钮不放说明；杠杆下面固定一句风险提示；自定义倍数做成明显的输入框；保证金下面并排显示保证金和仓位价值
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
            {/* 杠杆 1~100 倍（2026-09-27 goat 定）。实际不超过该币种在交易所的上限 */}
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
              {/* 填的是实际投入的保证金，不是仓位；仓位价值 = 保证金 × 杠杆（2026-09-27 goat） */}
              {marginNum >= 10 && (
                <dl className="mt-2 grid grid-cols-2 overflow-hidden rounded-xl bg-card2 text-center">
                  <div className="px-3 py-2.5"><dt className="text-[11px] text-muted">{t('保证金')}</dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{fmtNum(marginNum)} <span className="text-xs font-normal text-muted">USDT</span></dd></div>
                  <div className="border-l border-line/70 px-3 py-2.5"><dt className="text-[11px] text-muted">{t('仓位价值')}</dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{fmtNum(marginNum * leverage)} <span className="text-xs font-normal text-muted">USDT</span></dd></div>
                </dl>
              )}
            </div>
          </div>
        )}
        {/* 现货交易：还没在用现货（刚领养 / 从合约换过来）就直接在这里开始：每天额度 + 开启自动交易 / 每次先问我（2026-10-05 goat） */}
        {mode === 'confirm' && fly.mode !== 'confirm' && <SpotStart open={open} fly={fly} onStarted={(f) => onSaved(f, { started: true })} onDone={onClose} onAutoSheet={onAutoSheet} onAddFunds={() => setReceiving(true)} />}
        {mode === 'confirm' && fly.mode === 'confirm' && <p className="text-sm text-muted">{t('小精灵想买卖时会问你，开了自动交易就自动买卖。')}</p>}
        {(mode === 'perp' || fly.mode === 'confirm') && <Button size="lg" className="w-full" loading={busy} onClick={save}>{fly.mode === 'pending' ? t('开始') : t('保存')}</Button>}
        {/* 2026-10-05 goat「文字一定要简单」：协议不整段摆出来，点「交易协议」才展开；点按钮即同意 */}
        <p className="-mt-2 text-center text-xs text-muted">{t('开启即同意')}<button type="button" className="text-accent underline-offset-2 hover:underline" aria-expanded={showTerms} onClick={() => setShowTerms((v) => !v)}>{t('交易协议')}</button></p>
        {showTerms && <ol className="list-decimal space-y-1 rounded-xl bg-card2 py-3 pl-8 pr-4 text-xs leading-relaxed text-muted">{AGREEMENT.map((l, i) => <li key={i}>{t(l)}</li>)}</ol>}
      </div>
    </Sheet>
    <ReceiveSheet open={open && receiving} onClose={() => { setReceiving(false); void refreshPortfolio() }} address={address} evmAddress={evmAddress} initialNet="evm" />
    </>
  )
}
