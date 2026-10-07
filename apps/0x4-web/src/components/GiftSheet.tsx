// Gift tipping (Lyra's request): top up platform balance (USD-denominated) with USDC / USDT etc. → pick a gift to send. Recipients accumulate earnings, withdrawable under "Me"
import { useSocial } from '@/store/social'
import { useEffect, useState } from 'react'
import { Gift, Wallet } from 'lucide-react'
import Sheet from './Sheet'
import Button from './Button'
import Avatar from './Avatar'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { transfer } from '@/lib/transfer'
import { fmtAmount, fmtUsd } from '@/lib/format'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { usePortfolio } from '@/store/portfolio'
import { findHolding } from '@/lib/tokens'
import { chainName, SOLANA_CHAIN_ID } from '@/lib/chains'
import { displayName, proveEvmIfNeeded } from '@/store/social'
import { t } from '@/lib/i18n'
import { GiftIcon, giftName } from './gifts'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

export interface GiftDef { id: string; name: string; emoji: string; price: number }
export interface PayAsset { chainId: number; address: string; symbol: string; decimals: number; kind: 'stable' | 'token' }
export interface GiftWallet { catalog: GiftDef[]; balance: number; earnings: number; totalSent: number; totalReceived: number; assets: PayAsset[]; treasury: { evm: string | null; solana: string | null }; feeBps: number; minWithdraw: number; dryRun: boolean }
export interface Recipient { address: string; nickname?: string | null; avatar?: string | null }

export function useGiftWallet() {
  const [w, setW] = useState<GiftWallet | null>(null)
  const load = () => api<GiftWallet>('/api/gifts').then(setW).catch(() => {})
  // Read only after login (unlogged reads always 401: adoption / transfer panels hanging on web pages without a connected wallet must not request)
  const ready = useSocial((s) => s.status === 'ready')
  useEffect(() => { if (ready) load() }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  return { wallet: w, reload: load }
}

export default function GiftSheet({ open, onClose, recipients, initial, groupId, roomId }: { open: boolean; onClose: () => void; recipients: Recipient[]; initial?: Recipient | null; groupId?: string; roomId?: string }) {
  const { address } = useWallet()
  const { wallet, reload } = useGiftWallet()
  const [to, setTo] = useState<Recipient | null>(initial ?? null)
  const [gift, setGift] = useState<GiftDef | null>(null)
  const [qty, setQty] = useState(1)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [topup, setTopup] = useState(false)

  const candidates = recipients.filter((r) => r.address !== address)
  // Auto-select when there's only one option
  useEffect(() => { if (!to && candidates.length === 1) setTo(candidates[0]) }, [to, candidates])
  const cost = (gift?.price || 0) * qty
  const enough = !!wallet && wallet.balance >= cost
  const valid = !!to && !!gift && qty >= 1

  const send = async () => {
    if (!valid || !gift || !to) return
    if (!enough) return setTopup(true)
    setBusy(true)
    try {
      await api('/api/gifts/send', { method: 'POST', body: JSON.stringify({ to: to.address, giftId: gift.id, qty, groupId, roomId, message: message.trim() || undefined }) })
      const name = t(giftName(gift.id, gift.name))
      toast.success(qty > 1 ? t('已送出 {n} 个「{name}」', { n: qty, name }) : t('已送出「{name}」', { name }))
      onClose()
    } catch (e) {
      const msg = errorText(e, t('送礼失败'))
      if (msg.includes('余额')) setTopup(true); else toast.error(msg)
    } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('送礼物')} half={!!roomId}>
      <div className="space-y-4">
        {candidates.length > 1 && (
          <div>
            <Label>{t('送给')}</Label>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
              {candidates.map((m) => (
                <button key={m.address} onClick={() => setTo(m)} className={`flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl p-1.5 ${to?.address === m.address ? 'bg-accent/15 ring-2 ring-accent' : ''}`}>
                  <Avatar address={m.address} src={m.avatar} name={m.nickname} size={40} />
                  <UserName address={m.address} name={displayName(m)} className="w-full truncate text-center text-[11px]" />
                </button>
              ))}
            </div>
          </div>
        )}
        {candidates.length === 1 && to && <div className="flex items-center gap-2 text-sm"><Avatar address={to.address} src={to.avatar} name={to.nickname} size={28} />{t('送给')} <b><UserName address={to.address} name={displayName(to)} /></b></div>}

        <div className="flex items-center justify-between rounded-2xl bg-card2 px-4 py-3">
          <div className="text-sm"><span className="text-muted">{t('我的余额')}</span> <b>{wallet ? fmtUsd(wallet.balance) : '--'}</b></div>
          <Button size="sm" variant="secondary" onClick={() => setTopup(true)}><Wallet size={14} /> {t('充值')}</Button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {(wallet?.catalog || []).map((g) => (
            <button key={g.id} onClick={() => setGift(g)} className={`flex flex-col items-center rounded-2xl py-3 ${gift?.id === g.id ? 'bg-accent/15 ring-2 ring-accent' : 'bg-card2'}`}>
              <GiftIcon id={g.id} size={44} className={`transition-transform duration-200 ${gift?.id === g.id ? 'scale-110 -rotate-6' : ''}`} />
              <span className="mt-1 text-xs font-semibold">{t(giftName(g.id, g.name))}</span>
              <span className="text-[11px] text-muted">{fmtUsd(g.price)}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Label>{t('数量')}</Label>
          <div className="flex gap-1">{[1, 5, 10, 66, 99].map((n) => <button key={n} onClick={() => setQty(n)} className={`rounded-lg px-2.5 py-1 text-sm ${qty === n ? 'bg-accent text-bg' : 'bg-card2'}`}>{n}</button>)}</div>
        </div>
        <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('留言（会显示在群里）')} maxLength={100} />

        <Button size="lg" className="w-full" disabled={!valid} loading={busy} onClick={send}>
          {gift && enough ? <GiftIcon id={gift.id} size={24} /> : <Gift size={18} />} {gift ? (enough ? t('送出 {name} × {n} · {cost}', { name: t(giftName(gift.id, gift.name)), n: qty, cost: fmtUsd(cost) }) : t('余额不足，去充值（需 {cost}）', { cost: fmtUsd(cost) })) : t('选一个礼物')}
        </Button>
      </div>
      <TopupSheet open={topup} onClose={() => { setTopup(false); reload() }} wallet={wallet} />
    </Sheet>
  )
}

/** Top-up: pick an asset (USDC / USDT first) to transfer from your wallet to the platform vault address; the tx hash goes to the server for USD crediting */
export function TopupSheet({ open, onClose, wallet, need }: { open: boolean; onClose: () => void; wallet: GiftWallet | null; need?: number }) {
  const { wallet: signer, evmAccount } = useWallet()
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const holdings = usePortfolio((s) => s.holdings)
  const [asset, setAsset] = useState<PayAsset | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  // Asset options: held-in-wallet first, stables preferred
  const options = (wallet?.assets || []).map((a) => ({ ...a, held: findHolding(holdings, { chainId: a.chainId, address: a.address, symbol: a.symbol, name: a.symbol, decimals: a.decimals })?.amount ?? 0, price: findHolding(holdings, { chainId: a.chainId, address: a.address, symbol: a.symbol, name: a.symbol, decimals: a.decimals })?.priceUsd ?? (a.kind === 'stable' ? 1 : undefined) }))
    .filter((a) => a.kind === 'stable' || a.held > 0) // Non-stables (e.g. BNG) only appear when actually held in the wallet
    .sort((x, y) => (y.held > 0 ? 1 : 0) - (x.held > 0 ? 1 : 0) || (x.kind === 'stable' ? 0 : 1) - (y.kind === 'stable' ? 0 : 1))
  useEffect(() => { if (open && !asset && options.length) setAsset(options[0]) }, [open, options.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && need && !amount) setAmount(String(Math.ceil(need))) }, [open, need]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = options.find((o) => asset && o.chainId === asset.chainId && o.address === asset.address)
  const amt = Number(amount)
  const usd = cur?.price ? amt * cur.price : cur?.kind === 'stable' ? amt : undefined

  const submit = async () => {
    if (!wallet || !asset) return
    setBusy(true)
    try {
      let tx: string
      if (wallet.dryRun) tx = `dry:${usd ?? amt}:${Date.now()}` // Test env: amount:timestamp, to avoid duplicates
      else {
        const treasury = asset.chainId === SOLANA_CHAIN_ID ? wallet.treasury.solana : wallet.treasury.evm
        if (!treasury) throw new Error(t('暂不支持从这条链充值'))
        // EVM assets: the server only recognizes the payment address after a signed proof — prove first, then transfer, so money can't leave without being credited
        if (asset.chainId !== SOLANA_CHAIN_ID && !(await proveEvmIfNeeded({ interactive: true }).catch(() => false))) throw new Error(t('EVM 地址验证失败，请稍后再试'))
        tx = await transfer({ chainId: asset.chainId, token: asset.address, decimals: asset.decimals, amount: amt, to: treasury }, { solana: signer, evm: evmAccount, solanaRpc: rpcUrl })
      }
      const r = await api<{ amount: number; balance: number }>('/api/credits/topup', { method: 'POST', body: JSON.stringify({ tx, chainId: asset.chainId, token: asset.address }) })
      toast.success(t('已充值 {amount}，余额 {balance}', { amount: fmtUsd(r.amount), balance: fmtUsd(r.balance) }))
      onClose()
    } catch (e) { toast.error(errorText(e, t('充值失败'))) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('充值')}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('从你的钱包转入平台，按当时价格折算成美元余额。余额用于送礼物、领养小精灵等平台内消费。')}</p>
        <Label>{t('用什么付')}</Label>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {options.map((o) => <button key={`${o.chainId}:${o.address}`} onClick={() => setAsset(o)} className={`shrink-0 rounded-xl px-3 py-2 text-left text-sm ${cur === o ? 'bg-accent text-bg' : 'bg-card2'}`}><div className="font-semibold">{o.symbol}</div><div className={`text-[10px] ${cur === o ? 'text-bg/70' : 'text-muted'}`}>{chainName(o.chainId)}{o.held > 0 ? ` · ${t('有 {amount}', { amount: fmtAmount(o.held) })}` : ''}</div></button>)}
        </div>
        <div className="flex items-center justify-between"><Label>{t('金额（{symbol}）', { symbol: asset?.symbol || '' })}</Label>{usd !== undefined && amt > 0 && <span className="mb-1.5 text-xs text-muted">≈ {fmtUsd(usd)}</span>}</div>
        <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" />
        <div className="flex gap-2">{[10, 20, 50, 100].map((v) => <button key={v} onClick={() => setAmount(String(v))} className="flex-1 rounded-xl bg-card2 py-1.5 text-sm font-semibold">{v}</button>)}</div>
        {!wallet?.dryRun && cur && amt > cur.held && <div className="text-xs text-down">{t('钱包里的 {symbol} 不够，可以先在「闪兑」里换一些', { symbol: cur.symbol })}</div>}
        <Button size="lg" className="w-full" disabled={!asset || !(amt > 0) || (!wallet?.dryRun && !!cur && amt > cur.held)} loading={busy} onClick={submit}>{t('确认充值')}</Button>
      </div>
    </Sheet>
  )
}
