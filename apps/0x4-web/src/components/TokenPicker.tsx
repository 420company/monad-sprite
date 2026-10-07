// Token picker sheet: filter by chain; my assets first, then common tokens, then LI.FI search results
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import Sheet from './Sheet'
import TokenLogo from './TokenLogo'
import ChainBadge from './ChainBadge'
import { BTC_CHAIN, CHAINS, MAIN_CHAIN_IDS, SOLANA_CHAIN_ID, chainById, type ChainToken } from '@/lib/chains'
import { searchLifiTokens } from '@/lib/lifi'
import { findHolding, holdingToToken, tokenKey } from '@/lib/tokens'
import { fmtAmount, fmtUsd } from '@/lib/format'
import { usePortfolio } from '@/store/portfolio'
import { useFavorites } from '@/store/favorites'
import { isOfficial, rankPicked } from '@/lib/tokenRank'
import { t } from '@/lib/i18n'

export type PickedToken = ChainToken & { amount?: number }

export default function TokenPicker({
  open, onClose, onSelect, title = t('选择代币'), onlyHoldings = false, exclude,
}: {
  open: boolean
  onClose: () => void
  onSelect: (t: PickedToken) => void
  title?: string
  /** Only selectable from holdings (used as the payment asset) */
  onlyHoldings?: boolean
  exclude?: ChainToken
}) {
  const holdings = usePortfolio((s) => s.holdings)
  const [chain, setChain] = useState<number | undefined>(undefined)
  const [chainOpen, setChainOpen] = useState(false)
  const [q, setQ] = useState('')
  const { mine, favs, common, more, searching } = usePickerLists({ open, q, chain, onlyHoldings, exclude })

  useEffect(() => { if (open) setQ('') }, [open])

  const pick = (t: ChainToken) => {
    const h = findHolding(holdings, t)
    onSelect({ ...t, amount: h?.amount })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-3.5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索符号、名称或合约地址')} className="h-11 w-full rounded-2xl bg-card2 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/50" />
      </div>
      {/* Chain filter: one button opening a small panel; no more endless horizontal scrolling */}
      <div className="relative mb-3">
        <button onClick={() => setChainOpen((v) => !v)} aria-expanded={chainOpen} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-card2 px-3 text-sm">
          {chain ? <><img src={chainById(chain)?.logo} alt="" className="h-4 w-4 rounded-full" /><span className="flex-1 text-left font-medium">{chainById(chain)?.name}</span></> : <span className="flex-1 text-left text-muted">{t('选择链路（当前：全部）')}</span>}
          <ChevronDown size={16} className={`text-muted transition-transform ${chainOpen ? 'rotate-180' : ''}`} />
        </button>
        {chainOpen && (
          <div className="toast-solid no-scrollbar absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line p-2 shadow-2xl">
            <button onClick={() => { setChain(undefined); setChainOpen(false) }} className={`flex min-h-11 w-full items-center rounded-lg px-3 text-sm ${!chain ? 'bg-accent/15 font-semibold text-accent' : ''}`}>{t('全部链')}</button>
            {/* Bitcoin (2026-09-30 BTC instant swap): not in CHAINS — placed last on its own */}
            {[...CHAINS, BTC_CHAIN].map((c) => (
              <button key={c.id} onClick={() => { setChain(c.id); setChainOpen(false) }} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm ${chain === c.id ? 'bg-accent/15 font-semibold text-accent' : ''}`}>
                <img src={c.logo} alt="" className="h-4 w-4 rounded-full" />{c.name}{MAIN_CHAIN_IDS.includes(c.id) ? '' : <span className="ml-auto text-[11px] text-muted">EVM</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {mine.length > 0 && <Group label={t('我的资产')}>{mine.map((t) => <Row key={tokenKey(t)} t={t} amount={t.amount} onClick={() => pick(t)} />)}</Group>}
      {favs.length > 0 && <Group label={t('收藏')}>{favs.map((t) => <Row key={tokenKey(t)} t={t} onClick={() => pick(t)} />)}</Group>}
      {common.length > 0 && <Group label={t('常用')}>{common.map((t) => <Row key={tokenKey(t)} t={t} onClick={() => pick(t)} />)}</Group>}
      {(more.length > 0 || searching) && (
        <Group label={searching ? t('搜索中…') : t('搜索结果')}>{more.map((t) => <Row key={tokenKey(t)} t={t} onClick={() => pick(t)} />)}</Group>
      )}
      {!mine.length && !favs.length && !common.length && !more.length && !searching && (
        <div className="py-10 text-center text-sm text-muted">{onlyHoldings ? t('没有可用于支付的资产') : t('没有找到代币')}</div>
      )}
    </Sheet>
  )
}


function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  )
}

function Row({ t, amount, onClick }: { t: ChainToken; amount?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left active:bg-card2">
      <TokenLogo src={t.logo} symbol={t.symbol} size={36} chain={t.chainId === SOLANA_CHAIN_ID ? 'solana' : undefined} address={t.address} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="font-semibold">{t.symbol}</span><ChainBadge chainId={t.chainId} />{isOfficial(t) && <OfficialTag />}</div>
        <div className="truncate text-xs text-muted">{t.name}</div>
      </div>
      {amount !== undefined && (
        <div className="text-right">
          <div className="text-sm font-semibold">{fmtAmount(amount)}</div>
          {t.priceUsd ? <div className="text-xs text-muted">{fmtUsd(amount * t.priceUsd)}</div> : null}
        </div>
      )}
    </button>
  )
}

/** Official-contract badge in search results (ranking rules in lib/tokenRank.ts) */
export const OfficialTag = () => <span className="shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-tight text-accent bg-accent/15">{t('官方')}</span>

/**
 * Token picker list data: my assets → favorites → common → remote search results (shared by the mobile picker sheet and the web dropdown src/desktop/trade/AssetPicker.tsx, 2026-09-29).
 * Clear the last search results when open turns true; remote search needs q ≥ 2 chars.
 */
export function usePickerLists({ open, q, chain, onlyHoldings = false, exclude }: { open: boolean; q: string; chain?: number; onlyHoldings?: boolean; exclude?: ChainToken }) {
  const holdings = usePortfolio((s) => s.holdings)
  const favorites = useFavorites((s) => s.items)
  const [remote, setRemote] = useState<ChainToken[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => { if (open) setRemote([]) }, [open])

  // Remote search (debounced)
  useEffect(() => {
    if (onlyHoldings || q.trim().length < 2) { setRemote([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      searchLifiTokens(chain, q).then(setRemote).catch(() => setRemote([])).finally(() => setSearching(false))
    }, 400)
    return () => clearTimeout(t)
  }, [q, chain, onlyHoldings])

  const { mine, favs, common, more } = useMemo(() => {
    const k = q.trim().toLowerCase()
    const match = (t: ChainToken) => !k || t.symbol.toLowerCase().includes(k) || t.name.toLowerCase().includes(k) || t.address.toLowerCase() === k
    const notExcluded = (t: ChainToken) => !exclude || tokenKey(t) !== tokenKey(exclude)
    const inChain = (t: ChainToken) => !chain || t.chainId === chain

    const mine = holdings.map(holdingToToken).filter((t) => t.amount > 0 && inChain(t) && notExcluded(t) && match(t)).sort((a, b) => b.amount * (b.priceUsd || 0) - a.amount * (a.priceUsd || 0))
    const seen = new Set(mine.map(tokenKey))
    const favs: ChainToken[] = onlyHoldings ? [] : favorites
      .filter((f) => f.decimals !== undefined && chainById(f.chainId))
      .map((f) => ({ chainId: f.chainId, address: f.address, symbol: f.symbol, name: f.name, decimals: f.decimals!, logo: f.logo }))
      .filter((t) => !seen.has(tokenKey(t)) && inChain(t) && notExcluded(t) && match(t))
    favs.forEach((t) => seen.add(tokenKey(t)))
    // Bitcoin also listed under common (2026-09-30 BTC instant swap: pick it when buying BTC; when selling BTC it's already in "my assets")
    const common = onlyHoldings ? [] : [...CHAINS, BTC_CHAIN].filter((c) => !chain || c.id === chain).flatMap((c) => [c.native, ...c.tokens]).filter((t) => !seen.has(tokenKey(t)) && notExcluded(t) && match(t))
    common.forEach((t) => seen.add(tokenKey(t)))
    const more = rankPicked(remote.filter((t) => !seen.has(tokenKey(t)) && notExcluded(t) && chainById(t.chainId)), q)
    return { mine, favs, common, more }
  }, [holdings, favorites, q, chain, exclude, onlyHoldings, remote])
  return { mine, favs, common, more, searching }
}
