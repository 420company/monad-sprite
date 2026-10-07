// 添加自定义代币：粘贴合约地址 → 自动识别所在链 → 加入收藏
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, Star } from 'lucide-react'
import Sheet from './Sheet'
import Button from './Button'
import TokenLogo from './TokenLogo'
import ChainBadge from './ChainBadge'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { tokenPath } from './TokenRow'
import { lookupAnyChain } from '@/lib/market'
import { detectAddressType, SOLANA_CHAIN_ID, chainById } from '@/lib/chains'
import { getMintDecimals } from '@/lib/rpc'
import { getErc20Decimals } from '@/lib/evm'
import { fmtUsd } from '@/lib/format'
import { useFavorites } from '@/store/favorites'
import { useMarket } from '@/store/market'
import { useSettings } from '@/store/settings'
import type { MarketToken } from '@/lib/types'
import { t } from '@/lib/i18n'

export default function AddTokenSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const { add, has, setDecimals } = useFavorites()
  const put = useMarket((s) => s.put)
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const [addr, setAddr] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<MarketToken[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { if (open) { setAddr(''); setResults(null); setErr(null) } }, [open])

  const type = detectAddressType(addr)

  // 地址合法后自动查询
  useEffect(() => {
    setResults(null); setErr(null)
    if (!type) return
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        let list = await lookupAnyChain(addr)
        if (!list.length) setErr(t('没有找到这个合约的交易对，请确认地址是否正确、是否已上线 DEX'))
        put(list)
        setResults(list)
      } catch {
        setErr(t('行情暂时无法加载，请稍后再试'))
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [addr, type, put])

  const paste = async () => {
    try { setAddr((await navigator.clipboard.readText()).trim()) } catch { toast.error(t('无法读取剪贴板，请手动粘贴')) }
  }

  const doAdd = async (tk: MarketToken) => {
    if (!chainById(tk.chainId)) return toast.error(t('暂不支持 {chain} 链', { chain: tk.chain }))
    add({ chain: tk.chain, chainId: tk.chainId, address: tk.address, symbol: tk.symbol, name: tk.name, logo: tk.logo, decimals: tk.decimals })
    toast.success(t('已收藏 {symbol}', { symbol: tk.symbol }))
    onClose()
    nav(tokenPath(tk))
    // 精度决定买卖时的数量换算：后台读取，不阻塞界面；读不到就在交易前再补
    if (tk.decimals === undefined) {
      const p = tk.chainId === SOLANA_CHAIN_ID ? getMintDecimals(rpcUrl, tk.address) : getErc20Decimals(tk.chainId, tk.address)
      p.then((d) => setDecimals(tk.chain, tk.address, d)).catch(() => {})
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('添加代币')}>
      <Label>{t('粘贴合约地址（支持 Solana 与所有 EVM 链）')}</Label>
      <div className="flex gap-2">
        <Input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder={t('例如 DezXAZ8z… 或 0x1234…')} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        <Button variant="secondary" className="shrink-0 px-3" onClick={paste} aria-label={t('粘贴')}><ClipboardPaste size={18} /></Button>
      </div>
      {addr && !type && <div className="mt-1 text-xs text-down">{t('地址格式不正确')}</div>}
      {loading && <div className="mt-4 text-sm text-muted">{t('识别中…')}</div>}
      {err && <div className="mt-4 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{err}</div>}
      {results && results.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-muted">{results.length > 1 ? t('这个地址在多条链上都有代币，请选择：') : t('识别结果')}</div>
          {results.map((tk) => {
            const exists = has(tk.chain, tk.address)
            const supported = !!chainById(tk.chainId)
            return (
              <button key={`${tk.chain}:${tk.address}`} onClick={() => !exists && doAdd(tk)} disabled={!supported} className="flex w-full items-center gap-3 rounded-2xl bg-card2 p-3 text-left active:bg-line disabled:opacity-50 mb-2">
                <TokenLogo src={tk.logo} symbol={tk.symbol} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold">{tk.symbol} <ChainBadge chainId={tk.chainId} />{!supported && <span className="text-[10px] text-muted">{t('{chain}（暂不支持）', { chain: tk.chain })}</span>}</div>
                  <div className="truncate text-xs text-muted">{tk.name} · {fmtUsd(tk.priceUsd)} · {t('流动性 {v}', { v: fmtUsd(tk.liquidityUsd, { compact: true }) })}</div>
                </div>
                <span className={`flex items-center gap-1 text-xs font-semibold ${exists ? 'text-muted' : 'text-accent'}`}><Star size={14} fill={exists ? 'currentColor' : 'none'} />{exists ? t('已收藏') : t('收藏')}</span>
              </button>
            )
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">{t('收藏后会出现在「发现 → 收藏」里，任何链上的代币都可以用你钱包里的任意资产直接买入。')}</p>
    </Sheet>
  )
}
