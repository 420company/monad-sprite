// Web "Spot" (2026-09-29 goat: the nav needs two real features — spot and perps).
// Left: my positions and favorites — tapping in opens the coin detail (K-lines left, buy/sell panel right); right: swap / cross-chain panel, any coin on any chain swaps directly.
// Both blocks are the phone app's same code — not previews.
import { Link } from 'react-router-dom'
import { Star, Wallet } from 'lucide-react'
import Swap from '@/pages/Swap'
import TokenLogo from '@/components/TokenLogo'
import TokenRow from '@/components/TokenRow'
import PriceChange from '@/components/PriceChange'
import { usePortfolio } from '@/store/portfolio'
import { useFavorites } from '@/store/favorites'
import { useMarket } from '@/store/market'
import { useSettings } from '@/store/settings'
import { marketKey } from '@/lib/market'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, isNative } from '@/lib/chains'
import { fmtAmount, fmtMoney, fmtUsd } from '@/lib/format'
import { pressPrefetchHandlers } from '@/lib/candlePrefetch'
import { t } from '@/lib/i18n'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WalletRequired } from '@/desktop/WalletRequired'

export default function Spot() {
  const { holdings, btc, lastUpdated } = usePortfolio()
  // Web with no wallet connected: show an explainer in the positions area, swap the right-side panel for a "Connect 0x4 Wallet" placeholder; favorites still viewable
  const connected = useWallet(isWalletConnected)
  const favorites = useFavorites((s) => s.items)
  const cache = useMarket((s) => s.cache)
  const hideBalance = useSettings((s) => s.hideBalance)
  const positions = (btc ? [...holdings, btc].sort((a, b) => b.valueUsd - a.valueUsd) : holdings).filter((h) => h.amount > 0)
  const mask = (v: string) => (hideBalance ? '****' : v)

  return (
    <div className="spot-desk">
      <div className="spot-side">
        <section aria-label={t('持仓')}>
          <div className="section-header page-gutter"><h2 className="section-title">{t('持仓')}</h2>{lastUpdated > 0 && <span className="number text-[13px] text-muted">{t('{n} 项资产', { n: positions.length })}</span>}</div>
          {!connected && <div className="page-gutter flex items-center gap-3 py-3"><Wallet size={20} strokeWidth={1.5} className="shrink-0 text-muted" /><p className="text-sm text-muted">{t('连接 0x4 Wallet 后显示你的持仓')}</p></div>}
          {connected && !lastUpdated && <div className="page-gutter space-y-3 py-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>}
          {connected && lastUpdated > 0 && !positions.length && <div className="page-gutter flex items-center gap-3 py-3"><Wallet size={20} strokeWidth={1.5} className="shrink-0 text-muted" /><p className="text-sm text-muted">{t('钱包里还没有资产')}</p></div>}
          {positions.map((h) => (
            <Link key={`${h.chainId}:${h.mint}`} to={h.chainId === BTC_CHAIN_ID ? `/swap?from=${BTC_CHAIN_ID}:bitcoin` /* Bitcoin swap (2026-09-30): tapping BTC goes straight to the swap, pre-selecting sell-BTC */ : h.chainId !== SOLANA_CHAIN_ID && isNative(h.mint) ? '/swap' : `/token/${chainById(h.chainId)?.dexKey || 'solana'}/${h.mint}`} {...(h.chainId !== BTC_CHAIN_ID ? pressPrefetchHandlers({ chain: chainById(h.chainId)?.dexKey || 'solana', address: h.mint }) : {})} className="token-row list-row page-gutter">
              <TokenLogo src={h.logo} symbol={h.symbol} chain={h.chainId === SOLANA_CHAIN_ID ? 'solana' : chainById(h.chainId)?.dexKey} address={h.mint} />
              <div className="token-identity">
                <div className="truncate text-[15px] font-semibold">{h.symbol}</div>
                <div className="number mt-1 truncate text-xs text-muted">{mask(fmtAmount(h.amount))} · {chainById(h.chainId)?.name || t('未知网络')}</div>
              </div>
              <div className="token-price number">
                <div className="text-sm font-semibold">{mask(h.priceUsd > 0 ? (h.valueUsd >= 1e6 ? fmtUsd(h.valueUsd, { compact: true }) : fmtMoney(h.valueUsd)) : '--')}</div>
                <PriceChange value={h.priceUsd > 0 ? h.change24h : undefined} className="mt-1 block text-[13px]" />
              </div>
            </Link>
          ))}
        </section>
        <section className="mt-6" aria-label={t('自选')}>
          <div className="section-header page-gutter"><h2 className="section-title">{t('自选')}</h2><Link to="/discover" className="text-action">{t('查看全部')}</Link></div>
          {favorites.map((f) => <TokenRow key={`${f.chain}:${f.address}`} token={{ ...(cache[marketKey(f.chain, f.address)] || f), symbol: f.symbol }} />)}
          {!favorites.length && <div className="page-gutter flex items-center gap-3 py-3"><Star size={20} strokeWidth={1.5} className="shrink-0 text-muted" /><p className="text-sm text-muted">{t('还没有自选，在币种页点星标即可加入')}</p></div>}
        </section>
      </div>
      <div className="spot-main">{connected ? <Swap embedded /> : <WalletRequired compact />}</div>
    </div>
  )
}
