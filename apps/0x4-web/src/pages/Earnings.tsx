// Balance, gift earnings, and withdrawals (USD-denominated; withdrawals can be USDC / USDT etc.)
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronDown } from 'lucide-react'
import Button from '@/components/Button'
import Avatar from '@/components/Avatar'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { TopupSheet, useGiftWallet, type PayAsset } from '@/components/GiftSheet'
import { chainName, SOLANA_CHAIN_ID } from '@/lib/chains'
import { api } from '@/lib/social'
import { fmtAmount, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { displayName } from '@/store/social'
import { useWallet } from '@/store/wallet'
import { t } from '@/lib/i18n'
import { GiftIcon, giftName } from '@/components/gifts'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'
import { routeQuery } from '@/lib/route'

interface History { charges: { amount: number; reason: string; created_at: number }[]; received: { from_addr: string; gift_id: string; qty: number; value: number; fee: number; created_at: number; nickname: string | null; avatar: string | null }[]; topups: { amount: number; tx: string; created_at: number; asset?: string; asset_amount?: number }[]; withdrawals: { amount: number; tx: string | null; status: string; created_at: number; asset?: string; asset_amount?: number }[] }

export default function Earnings() {
  // Back: go back if there is a previous page (its state / scroll get restored); push / deep-link opens go to /settings
  const back = useBack('/settings')
  const { address, evmAddress } = useWallet()
  const [picking, setPicking] = useState(false)
  const [asset, setAsset] = useState<PayAsset | null>(null)
  const { wallet, reload } = useGiftWallet()
  const [history, setHistory] = useState<History | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  // Tapping "Top up" on the "Me" page arrives with ?topup=1 — opens the top-up sheet directly
  const [topup, setTopup] = useState(() => routeQuery().get('topup') === '1')
  const loadHistory = () => api<History>('/api/gifts/history').then(setHistory).catch(() => {})
  useEffect(() => { loadHistory() }, [])

  const withdraw = async () => {
    setBusy(true)
    try {
      // When no chip was tapped, use the one highlighted in the UI — don't let the backend fall back on its own; displayed and withdrawn must be the same
      const picked = asset || wallet?.assets.find((x) => x.kind === 'stable') || null
      const r = await api<{ tx: string }>('/api/credits/withdraw', { method: 'POST', body: JSON.stringify({ amount: Number(amount), chainId: picked?.chainId, token: picked?.address }) })
      toast.success(t('提现已到账')); setAmount(''); reload(); loadHistory()
      void r
    } catch (e) { toast.error(errorText(e, t('提现失败'))) } finally { setBusy(false) }
  }
  const giftLabel = (id: string) => t(giftName(id, wallet?.catalog.find((g) => g.id === id)?.name))

  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center gap-2"><button onClick={back} className="-ml-2 rounded-full p-2 text-muted"><ArrowLeft size={22} /></button><h1 className="text-2xl font-bold">{t('余额与收入')}</h1></div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-4"><div className="text-xs text-muted">{t('余额')}</div><div className="mt-1 text-2xl font-black">{wallet ? fmtUsd(wallet.balance) : '--'}</div><div className="text-xs text-muted">{t('送礼、领养小精灵')}</div><Button size="sm" variant="secondary" className="mt-2" onClick={() => setTopup(true)}>{t('充值')}</Button></div>
        <div className="rounded-2xl bg-card p-4"><div className="text-xs text-muted">{t('礼物收入')}</div><div className="mt-1 text-2xl font-black text-accent">{wallet ? fmtUsd(wallet.earnings) : '--'}</div><div className="text-xs text-muted">{t('可提现')}</div></div>
      </div>
      <div className="mt-4 rounded-2xl bg-card p-4">
        <Label>{t('提现资产')}</Label>
        {/* Chain picker: one button shows the current selection, tap to list all (previously a horizontal swipe row that couldn't be fully seen — 2026-09-25 goat feedback) */}
        {(() => {
          const opts = (wallet?.assets || []).filter((a) => a.kind === 'stable')
          const cur = asset || opts[0]
          return (
            <div className="mb-3">
              <button onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="flex min-h-11 w-full items-center justify-between rounded-xl bg-card2 px-3.5 text-sm font-semibold">
                <span>{cur ? `${cur.symbol} · ${chainName(cur.chainId)}` : '--'}</span><ChevronDown size={16} className={`text-muted transition-transform ${picking ? 'rotate-180' : ''}`} />
              </button>
              {picking && (
                <div className="mt-1.5 overflow-hidden rounded-xl bg-card2" role="listbox">
                  {opts.map((a) => {
                    const on = cur === a
                    return <button key={`${a.chainId}:${a.address}`} role="option" aria-selected={on} onClick={() => { setAsset(a); setPicking(false) }} className="flex min-h-11 w-full items-center justify-between border-t border-line px-3.5 text-left text-sm first:border-t-0">{a.symbol} · {chainName(a.chainId)}{on && <Check size={16} className="text-accent" />}</button>
                  })}
                </div>
              )}
            </div>
          )
        })()}
        <Label>{t('金额（美元）')} → {shortAddr(((asset || wallet?.assets[0])?.chainId === SOLANA_CHAIN_ID ? address : evmAddress) || '', 6)}</Label>
        <div className="flex gap-2"><Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('最少 {n}', { n: wallet?.minWithdraw ?? 5 })} /><Button disabled={!(Number(amount) >= (wallet?.minWithdraw ?? 5)) || Number(amount) > (wallet?.earnings ?? 0)} loading={busy} onClick={withdraw}>{t('提现')}</Button></div>
        <p className="mt-2 text-[11px] text-muted">{t('平台从每份礼物里抽成 {pct}%，收入已是扣除后的金额。累计收到 {received}，累计送出 {sent}。', { pct: (wallet?.feeBps ?? 4000) / 100, received: fmtUsd(wallet?.totalReceived || 0), sent: fmtUsd(wallet?.totalSent || 0) })}</p>
      </div>
      <h2 className="mt-6 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('收到的礼物')}</h2>
      {history?.received.map((r, i) => (
        <div key={i} className="flex items-center gap-3 py-2"><Avatar address={r.from_addr} src={r.avatar} name={r.nickname} size={32} /><div className="flex-1 text-sm">{t('{name} 送了 {gift} × {n}', { name: displayName({ address: r.from_addr, nickname: r.nickname }), gift: giftLabel(r.gift_id), n: r.qty })}</div><GiftIcon id={r.gift_id} size={34} /><div className="text-right text-xs"><div className="font-semibold">+{fmtUsd(r.value - r.fee)}</div><div className="text-muted">{timeAgo(r.created_at)}</div></div></div>
      ))}
      {history && !history.received.length && <div className="py-6 text-center text-xs text-muted">{t('还没有收到礼物')}</div>}
      <h2 className="mt-6 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('充值与提现记录')}</h2>
      {history?.topups.map((tp, i) => <div key={'t' + i} className="flex justify-between py-1.5 text-sm"><span>{t('充值')}</span><span>+{fmtUsd(tp.amount)}{tp.asset ? <span className="text-xs text-muted"> {fmtAmount(tp.asset_amount || 0)} {tp.asset.split('@')[0]}</span> : null} <span className="text-xs text-muted">{timeAgo(tp.created_at)}</span></span></div>)}
      {history?.withdrawals.map((w, i) => <div key={'w' + i} className="flex justify-between py-1.5 text-sm"><span>{t('提现')} <span className="text-xs text-muted">{w.status === 'done' ? t('已到账') : w.status === 'failed' ? t('失败已退回') : t('处理中')}</span></span><span>-{fmtUsd(w.amount)}{w.asset ? <span className="text-xs text-muted"> {fmtAmount(w.asset_amount || 0)} {w.asset.split('@')[0]}</span> : null} <span className="text-xs text-muted">{timeAgo(w.created_at)}</span></span></div>)}
      {history?.charges.map((c, i) => <div key={'c' + i} className="flex justify-between py-1.5 text-sm"><span>{c.reason}</span><span>-{fmtUsd(c.amount)} <span className="text-xs text-muted">{timeAgo(c.created_at)}</span></span></div>)}
      <TopupSheet open={topup} onClose={() => { setTopup(false); reload(); loadHistory() }} wallet={wallet} />
    </div>
  )
}
