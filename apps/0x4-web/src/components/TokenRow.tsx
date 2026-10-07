// 发现页 / 搜索结果 / 收藏页的代币行（支持所有链）
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { MarketToken } from '@/lib/types'
import { fmtUsd } from '@/lib/format'
import TokenLogo from './TokenLogo'
import PriceChange from './PriceChange'
import { chainById } from '@/lib/chains'
import { t } from '@/lib/i18n'
import { toast } from './Toast'
import { pressPrefetchHandlers } from '@/lib/candlePrefetch'

export const tokenPath = (t: { chain: string; address: string }) => `/token/${t.chain}/${t.address}`

// 自选只有身份信息时仍可显示；缺失行情不补成零价格。
export type TokenRowData = Omit<MarketToken, 'priceUsd'> & { priceUsd?: number }

export default function TokenRow({ token, rank, metric = 'marketCap' }: { token: TokenRowData; rank?: number; metric?: 'marketCap' | 'volume' }) {
  const chain = chainById(token.chainId)?.name || token.chain
  const value = metric === 'volume' ? token.volume24h : token.marketCap ?? token.fdv
  const hasPrice = token.priceUsd !== undefined && Number.isFinite(token.priceUsd) && token.priceUsd > 0
  return (
    <Link to={tokenPath(token)} {...pressPrefetchHandlers(token)} className="token-row list-row page-gutter" data-ranked={rank !== undefined || undefined}>
      {rank !== undefined && <span className="token-rank number text-center text-xs text-muted">{rank}</span>}
      <TokenLogo src={token.logo} symbol={token.symbol} chain={token.chain} address={token.address} />
      <div className="token-identity">
        <div className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold" title={token.name}><span className="truncate">{token.symbol}</span>
          {/* 搜索结果：主流币的官方合约 / 冒充主流币的（2026-09-30） */}
          {token.official && <span className="shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-tight text-accent bg-accent/15">{t('官方')}</span>}
          {token.impostor && <span className="shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-tight text-[#ffb86b] bg-[#ffb86b]/15">{t('非官方')}</span>}
          {/* 交易池 3 天内刚创建（2026-09-30 goat）：暖黄色，和「官方」「非官方」区分；长按说明风险 */}
          {token.fresh && <NewPoolBadge />}
        </div>
        <div className="mt-1 truncate text-xs text-muted" title={`${chain} · ${token.name}`}>{chain} · {metric === 'volume' ? t('成交||volume') : t('市值')} {fmtUsd(value, { compact: true })}</div>
      </div>
      <div className="token-price number">
        <div className="text-sm font-semibold">{fmtUsd(hasPrice ? token.priceUsd : undefined)}</div>
        {/* 24 小时涨跌拿不到时写流动性，不放一个「--」 */}
        {hasPrice && token.change24h == null && token.liquidityUsd
          ? <div className="mt-1 text-[12px] text-muted">{t('流动性 {v}', { v: fmtUsd(token.liquidityUsd, { compact: true }) })}</div>
          : <PriceChange value={hasPrice ? token.change24h : undefined} className="mt-1 block text-[13px] font-medium" />}
      </div>
    </Link>
  )
}

/** 「新创建」角标：电脑上悬停看说明，手机上长按弹说明（长按不会进到币详情） */
function NewPoolBadge() {
  const tip = t('这个币的交易池 3 天内刚创建，风险较高')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  return (
    <span
      className="shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-tight text-[#ffd166] bg-[#ffd166]/15"
      title={tip}
      aria-label={`${t('新创建')}：${tip}`}
      onPointerDown={() => { held.current = false; clear(); timer.current = setTimeout(() => { held.current = true; toast.info(tip) }, 450) }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onClick={(e) => { if (held.current) { e.preventDefault(); e.stopPropagation(); held.current = false } }}
      onContextMenu={(e) => e.preventDefault()}
    >{t('新创建')}</span>
  )
}
