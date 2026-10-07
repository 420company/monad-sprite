// 发送：从持仓里选任意资产（SOL / SPL / 各 EVM 链原生币 / ERC-20），按所在链校验地址、签名、给区块浏览器链接
import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import Button from '@/components/Button'
import ChainBadge from '@/components/ChainBadge'
import Sheet from '@/components/Sheet'
import TokenLogo from '@/components/TokenLogo'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { alertError } from '@/components/AlertDialog'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, isGasToken } from '@/lib/chains'
import BtcSendForm from '@/components/BtcSendForm'
import { fmtAmount, fmtUsd } from '@/lib/format'
import { isValidAddress } from '@/lib/rpc'
import { transfer } from '@/lib/transfer'
import type { Holding } from '@/lib/types'
import { usePortfolio } from '@/store/portfolio'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { t } from '@/lib/i18n'

const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a)
/** 原生币要留一点付手续费；代币不用（手续费从原生币扣） */
const reserveFor = (h: Holding) => (h.chainId === SOLANA_CHAIN_ID ? 0.001 : 0.0005)
// 燃料费币（Arc 的 USDC、Solana 的 SOL 也算）：发送「最多」时要留手续费。比特币的手续费在发送时另算，这里不留（行为和以前一样）
const isNativeHolding = (h: Holding) => h.chainId !== BTC_CHAIN_ID && isGasToken(h.chainId, h.mint)

export default function SendSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { wallet, evmAccount } = useWallet()
  const holdings = usePortfolio((s) => s.holdings)
  const btcHolding = usePortfolio((s) => s.btc)
  const rpcUrl = useSettings((s) => s.rpcUrl)
  // 比特币持仓单独存，发送列表里并进来
  const list = useMemo(() => [...holdings, ...(btcHolding ? [btcHolding] : [])].filter((h) => h.amount > 0).sort((a, b) => b.valueUsd - a.valueUsd), [holdings, btcHolding])
  const [picked, setPicked] = useState<Holding | null>(null)
  const [picking, setPicking] = useState(false)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const asset = picked ?? list[0] ?? null
  const solana = asset?.chainId === SOLANA_CHAIN_ID
  const bitcoin = asset?.chainId === BTC_CHAIN_ID
  const chain = asset ? chainById(asset.chainId) : undefined

  const max = asset ? Math.max(0, asset.amount - (isNativeHolding(asset) ? reserveFor(asset) : 0)) : 0
  const amt = Number(amount)
  const addrOk = !!to && (solana ? isValidAddress(to) : isEvmAddress(to))
  const valid = !!asset && addrOk && amt > 0 && amt <= max

  const submit = async () => {
    if (!asset) return
    if (solana ? !wallet : !evmAccount) return toast.error(t('钱包已锁定'))
    setLoading(true)
    try {
      const hash = await transfer({ chainId: asset.chainId, token: asset.mint, decimals: asset.decimals, amount, to }, { solana: wallet, evm: evmAccount, solanaRpc: rpcUrl })
      toast.success(t('已发送 {amount} {symbol}', { amount: fmtAmount(amt), symbol: asset.symbol }))
      if (chain) window.open(chain.explorerTx(hash), '_blank')
      setTo(''); setAmount('')
      onDone()
    } catch (e) {
      alertError(e, t('发送失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={asset ? t('发送 {symbol}', { symbol: asset.symbol }) : t('发送')}>
      {!asset ? (
        <div className="py-6 text-center text-sm text-muted">{t('暂无可发送的资产，请先充值。')}</div>
      ) : picking ? (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {list.map((h) => (
            <button key={`${h.chainId}:${h.mint}`} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-card" onClick={() => { setPicked(h); setPicking(false); setTo(''); setAmount('') }}>
              <TokenLogo src={h.logo} symbol={h.symbol} size={36} chain={h.chainId === SOLANA_CHAIN_ID ? 'solana' : undefined} address={h.mint} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">{h.symbol} <ChainBadge chainId={h.chainId} /></div>
                <div className="truncate text-xs text-muted">{fmtAmount(h.amount)} {h.symbol}</div>
              </div>
              <div className="text-sm font-semibold">{fmtUsd(h.valueUsd)}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>{t('资产')}</Label>
            <button className="flex w-full items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-left" onClick={() => setPicking(true)}>
              <TokenLogo src={asset.logo} symbol={asset.symbol} size={32} chain={asset.chainId === SOLANA_CHAIN_ID ? 'solana' : undefined} address={asset.mint} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">{asset.symbol} <ChainBadge chainId={asset.chainId} /></div>
                <div className="text-xs text-muted">{t('可用 {amount} {symbol}', { amount: fmtAmount(asset.amount), symbol: asset.symbol })}</div>
              </div>
              <ChevronDown size={18} className="text-muted" />
            </button>
          </div>
          {/* 只在弹层打开时挂载：关了就卸载，下次打开是新的表单（不停在上一笔的结果页） */}
          {bitcoin ? (open ? <BtcSendForm priceUsd={asset.priceUsd} /> : null) : <>
          <div>
            <Label>{t('接收地址')}</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={solana ? t('Solana 地址') : t('{chain} 地址（0x…）', { chain: chain?.name ?? 'EVM' })} spellCheck={false} />
            {to && !addrOk && <div className="mt-1 text-xs text-down">{solana ? t('不是合法的 Solana 地址') : t('不是合法的 0x 地址')}</div>}
            {/* 2026-09-30 goat：和插件同一说法「请确认该地址属于 X 网络」 */}
            {addrOk && <div className="mt-1 text-xs text-muted">{t('请确认该地址属于 {chain} 网络', { chain: solana ? 'Solana' : chain?.name ?? '' })}</div>}
          </div>
          <div>
            <div className="flex items-center justify-between"><Label>{t('数量（{symbol}）', { symbol: asset.symbol })}</Label><span className="mb-1.5 text-xs text-muted">{t('最多 {amount}', { amount: fmtAmount(max) })}</span></div>
            <div className="relative">
              <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              <button className="absolute right-3 top-3 text-xs font-semibold text-accent" onClick={() => setAmount(String(max))}>{t('最大')}</button>
            </div>
            {amt > 0 && asset.priceUsd > 0 && <div className="mt-1 text-xs text-muted">≈ {fmtUsd(amt * asset.priceUsd)}</div>}
            {amt > max && <div className="mt-1 text-xs text-down">{t('超过可用余额')}</div>}
          </div>
          <Button size="lg" className="w-full" disabled={!valid} loading={loading} onClick={submit}>{t('确认发送')}</Button>
          </>}
        </div>
      )}
    </Sheet>
  )
}
