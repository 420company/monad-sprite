// 自定义代币收藏：用户通过合约地址添加的代币（任意链），持久化保存
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SOLANA_CHAIN_ID } from '@/lib/chains'

export interface FavoriteToken {
  /** DexScreener 链标识 */
  chain: string
  /** LI.FI 链 id */
  chainId: number
  address: string
  symbol: string
  name: string
  logo?: string
  decimals?: number
  addedAt: number
}

/**
 * 默认自选：新装的 App 自带这 5 个，用户可以自己取消。
 * 自选按「链 + 合约地址」走 DexScreener 查行情，所以这里用的都是现货代币（原生币用包装版，
 * DEX 上交易的是它）。地址都在 DexScreener 实测过有交易对、价格正常（2026-09-25）。
 * symbol 写成大家熟悉的叫法，首页和自选列表显示用这个，行情里的 BTCB / WBNB 不直接露出来。
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
  /** 默认自选已经放过一次。之后用户取消哪个就是哪个，不再自动补回 */
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
      // 本机没存过自选（新装）：直接带上默认 5 个
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
      // version 1 起有 seeded 标记。老数据（version 0）没有标记：自选是空的就补上默认，
      // 不空就原样保留。迁移完 seeded 一律为 true，以后取消掉的不会再被加回。
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
