// 发红包：选资产 → 总额 / 个数 / 随机或均分 → 转入托管小钱包 → 确认到账后群里可领
import { useState } from 'react'
import { BALANCE_FEATURES } from '@/lib/features'
import { ChevronDown } from 'lucide-react'
import Sheet from './Sheet'
import Button from './Button'
import TokenLogo from './TokenLogo'
import TokenPicker, { type PickedToken } from './TokenPicker'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { TopupSheet, useGiftWallet } from './GiftSheet'
import { fmtUsd } from '@/lib/format'
import { api } from '@/lib/social'
import { transfer } from '@/lib/transfer'
import { NATIVE_EVM, NATIVE_SOL, SOLANA_CHAIN_ID, chainName, isNative, isStable, chainById } from '@/lib/chains'
import { fmtAmount } from '@/lib/format'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { usePortfolio } from '@/store/portfolio'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

interface Deposit { token: string; symbol: string; amount: number; decimals: number }

export default function RedPacketSheet({ open, onClose, groupId }: { open: boolean; onClose: () => void; groupId: string }) {
  const { wallet, evmAccount } = useWallet()
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const holdings = usePortfolio((s) => s.holdings)
  // 链上红包默认 BSC（2026-09-25 goat）：用 BSC 上价值最高的持仓，没有就默认 BNB
  const top = holdings.filter((h) => h.chainId === 56).sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))[0]
  const bnb = chainById(56)?.native
  const [asset, setAsset] = useState<PickedToken | null>(top ? { chainId: top.chainId, address: top.mint, symbol: top.symbol, name: top.name || top.symbol, decimals: top.decimals, logo: top.logo, amount: top.amount, priceUsd: top.priceUsd } : bnb ? { ...bnb, amount: 0 } : null)
  const [total, setTotal] = useState('')
  const [count, setCount] = useState('5')
  const [mode, setMode] = useState<'random' | 'equal'>('random')
  const [message, setMessage] = useState(() => t('恭喜发财，大吉大利'))
  const [picking, setPicking] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'creating' | 'transfer' | 'confirm'>('idle')
  // 默认余额红包（从平台余额扣，秒到）；手机 App 里没有余额类功能，只能发链上红包
  const [source, setSource] = useState<'credit' | 'chain'>(BALANCE_FEATURES ? 'credit' : 'chain')
  const { wallet: creditWallet, reload: reloadCredit } = useGiftWallet()
  const [topup, setTopup] = useState(false)

  const amt = Number(total)
  const n = Number(count)
  const valid = source === 'credit' ? amt >= 0.1 && n >= 1 && n <= 500 && amt / n >= 0.01 : !!asset && amt > 0 && amt <= (asset.amount ?? 0) && n >= 1 && n <= 500
  const creditEnough = !!creditWallet && creditWallet.balance >= amt
  const sendCredit = async () => {
    if (!creditEnough) return setTopup(true)
    try { setPhase('creating'); await api('/api/credits/packets', { method: 'POST', body: JSON.stringify({ groupId, total: amt, count: n, mode, message }) }); toast.success(t('余额红包已发出')); onClose() } catch (e) { const m = errorText(e, t('发红包失败')); if (m.includes('余额不足')) setTopup(true); else toast.error(m) } finally { setPhase('idle') }
  }

  const send = async () => {
    if (!valid || !asset) return
    try {
      setPhase('creating')
      const nativeAddr = asset.chainId === SOLANA_CHAIN_ID ? NATIVE_SOL : NATIVE_EVM
      const res = await api<{ packet: { id: string; depositAddress: string }; deposits: Deposit[] }>('/api/packets', {
        method: 'POST',
        body: JSON.stringify({ groupId, chainId: asset.chainId, token: isNative(asset.address) ? 'native' : asset.address, symbol: asset.symbol, decimals: asset.decimals, total: amt, count: n, mode, message }),
      })
      setPhase('transfer')
      const txs: string[] = []
      // 按清单逐笔转入托管小钱包（代币 + 手续费预留）
      for (const d of res.deposits) {
        txs.push(await transfer({ chainId: asset.chainId, token: d.token === 'native' ? nativeAddr : d.token, decimals: d.decimals, amount: d.amount, to: res.packet.depositAddress }, { solana: wallet, evm: evmAccount, solanaRpc: rpcUrl }))
      }
      setPhase('confirm')
      await api(`/api/packets/${res.packet.id}/fund`, { method: 'POST', body: JSON.stringify({ txs }) })
      toast.success(t('红包已发出'))
      onClose()
    } catch (e) {
      toast.error(errorText(e, t('发红包失败')))
    } finally {
      setPhase('idle')
    }
  }

  const reserveHint = asset ? (asset.chainId === SOLANA_CHAIN_ID ? t('另需约 {amount} SOL 作为领取手续费', { amount: fmtAmount(0.001 + n * (isNative(asset.address) ? 0.00001 : 0.0025)) }) : t('领取时还需少量该链的币付燃料费')) : ''

  return (
    <Sheet open={open} onClose={onClose} title={t('发红包')}>
      <div className="space-y-4">
        {BALANCE_FEATURES && <div className="flex rounded-2xl bg-card p-1">
          {(['credit', 'chain'] as const).map((k) => <button key={k} onClick={() => setSource(k)} className={`flex-1 rounded-xl py-2 text-sm font-semibold ${source === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{k === 'credit' ? t('余额红包') : t('链上红包')}</button>)}
        </div>}
        {source === 'credit' && (
          <>
            <div><Label>{t('总金额（美元）')}</Label><Input type="number" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="10" /></div>
            <div><Label>{t('红包个数')}</Label><Input type="number" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></div>
            <div className="flex rounded-2xl bg-card p-1">{(['random', 'equal'] as const).map((k) => <button key={k} onClick={() => setMode(k)} className={`flex-1 rounded-xl py-2 text-sm font-semibold ${mode === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{k === 'random' ? t('拼手气') : t('均分')}</button>)}</div>
            <div><Label>{t('留言')}</Label><Input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={100} /></div>
            <Button size="lg" className="w-full" disabled={!valid} loading={phase !== 'idle'} onClick={sendCredit}>{creditEnough || !amt ? t('塞钱进红包 {amount}', { amount: amt ? fmtUsd(amt) : '' }) : t('余额不足，先充值')}</Button>
            <TopupSheet open={topup} onClose={() => { setTopup(false); reloadCredit() }} wallet={creditWallet} need={Math.max(0, amt - (creditWallet?.balance || 0))} />
          </>
        )}
        {source === 'chain' && <>
        <div>
          <Label>{t('红包资产')}</Label>
          <button onClick={() => setPicking(true)} className="flex w-full items-center gap-2 rounded-2xl bg-card2 px-3 py-2.5 text-left">
            {asset ? <><TokenLogo src={asset.logo} symbol={asset.symbol} size={28} /><span className="font-semibold">{asset.symbol}</span><span className="text-xs text-muted">{t('{chain} · 余额 {amount}', { chain: chainName(asset.chainId), amount: fmtAmount(asset.amount || 0) })}</span></> : <span className="text-muted">{t('选择资产')}</span>}
            <ChevronDown size={16} className="ml-auto text-muted" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t('总金额')}</Label><Input type="number" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0" /></div>
          <div><Label>{t('红包个数')}</Label><Input type="number" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="5" /></div>
        </div>
        <div className="flex rounded-2xl bg-card2 p-1">
          {(['random', 'equal'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-xl py-2 text-sm font-semibold ${mode === m ? 'bg-card text-fg' : 'text-muted'}`}>{m === 'random' ? t('拼手气') : t('均分')}</button>
          ))}
        </div>
        {asset && amt > 0 && n > 0 && <div className="text-xs text-muted">{mode === 'equal' ? t('每人 {amount} {symbol}', { amount: fmtAmount(amt / n, 6), symbol: asset.symbol }) : t('人均 {amount} {symbol}，金额随机', { amount: fmtAmount(amt / n, 6), symbol: asset.symbol })}{asset && isStable(asset.symbol) ? '' : ''} · {reserveHint}</div>}
        <div><Label>{t('祝福语')}</Label><Input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={60} /></div>
        <p className="text-center text-[11px] text-muted">{asset?.chainId === SOLANA_CHAIN_ID ? t('24 小时内未领完的部分自动退回 Solana 钱包地址') : t('24 小时内未领完的部分自动退回 EVM 钱包地址')}</p>
        <Button size="lg" className="w-full bg-down text-white hover:brightness-95" variant="down" disabled={!valid} loading={phase !== 'idle'} onClick={send}>
          {phase === 'creating' ? t('创建中…') : phase === 'transfer' ? t('转账中…') : phase === 'confirm' ? t('确认到账…') : t('塞钱进红包')}
        </Button>
        </>}
      </div>
      <TokenPicker open={picking} onClose={() => setPicking(false)} title={t('选择红包资产')} onlyHoldings={holdings.length > 0} onSelect={setAsset} />
    </Sheet>
  )
}
