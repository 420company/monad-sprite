// Custom token favorites: user-added tokens by contract address (any chain), persisted
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SOLANA_CHAIN_ID } from '@/lib/chains'

export interface FavoriteToken {
  /** DexScreener chain id */
  chain: string
  /** LI.FI chain id */
  chainId: number
  address: string
  symbol: string
  name: string
  logo?: string
  decimals?: number
  addedAt: number
}

/**
 * Default watchlist: fresh installs ship with these 5; users may remove them.
 * Watchlist resolves market data via DexScreener by "chain + contract address", so these are all spot tokens
 * (native coins use their wrapped versions — that's what DEXs trade). Addresses verified on DexScreener to
 * have pairs and sane prices (2026-09-25).
 * symbols use familiar names for the home and watchlist display; the market's BTCB / WBNB never surface directly.
 */
export const DEFAULT_FAVORITES: Omit<FavoriteToken, 'addedAt'>[] = [
  { chain: 'bsc', chainId: 56, address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTC', name: 'Binance-Peg BTCB', decimals: 18 },
  { chain: 'bsc', chainId: 56, address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', name: 'Binance-Peg Ethereum', decimals: 18 },
  { chain: 'bsc', chainId: 56, address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'BNB', name: 'Wrapped BNB', decimals: 18 },
  { chain: 'solana', chainId: SOLANA_CHAIN_ID, address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 },
  { chain: 'solana', chainId: SOLANA_CHAIN_ID, address: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g', symbol: 'HYPE', name: 'Hyperliquid' },
]

const defaults = (): FavoriteToken[] => DEFAULT_FAVORITES.map((f, i) => ({ ...f, addedAt: i }))

interface FavoritesState {
  items: FavoriteToken[]
  /** Default watchlist seeded once. Afterwards, whatever the user removes stays removed — never auto-restored */
  seeded: boolean
  add: (t: Omit<FavoriteToken, 'addedAt'>) => void
  remove: (chain: string, address: string) => void
  has: (chain: string, address: string) => boolean
  setDecimals: (chain: string, address: string, decimals: number) => void
}

const same = (a: { chain: string; address: string }, chain: string, address: string) => a.chain === chain && a.address.toLowerCase() === address.toLowerCase()

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      // No locally saved watchlist (fresh install): seed the default 5
      items: defaults(),
      seeded: true,
      add(t) {
        if (get().has(t.chain, t.address)) return
        set({ items: [{ ...t, addedAt: Date.now() }, ...get().items] })
      },
      remove(chain, address) {
        set({ items: get().items.filter((x) => !same(x, chain, address)) })
      },
      has(chain, address) {
        return get().items.some((x) => same(x, chain, address))
      },
      setDecimals(chain, address, decimals) {
        set({ items: get().items.map((x) => (same(x, chain, address) ? { ...x, decimals } : x)) })
      },
    }),
    {
      name: '0x4.favorites',
      // The seeded flag exists since version 1. Old data (version 0) lacks it: empty watchlists get the defaults,
      // non-empty ones kept as-is. After migration seeded is always true — removed items never come back.
      version: 1,
      migrate: (persisted, version) => migrateFavorites(persisted, version),
    },
  ),
)

export function migrateFavorites(persisted: unknown, version: number): Pick<FavoritesState, 'items' | 'seeded'> {
  const old = (persisted || {}) as Partial<Pick<FavoritesState, 'items' | 'seeded'>>
  const items = Array.isArray(old.items) ? old.items : []
  if (version >= 1 || old.seeded) return { items, seeded: true }
  return { items: items.length ? items : defaults(), seeded: true }
}
