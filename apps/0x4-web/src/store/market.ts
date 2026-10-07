// 行情状态：热门列表、搜索、单币缓存（按 链:地址 索引）；接口失败只标记 offline，绝不用假数据顶上——那会让人对着假价格做决定
import { create } from 'zustand'
import type { MarketToken } from '@/lib/types'
import { getTokens, getTrending, searchTokens, marketKey, SOL_MINT } from '@/lib/market'

interface MarketState {
  trending: MarketToken[]
  loading: boolean
  offline: boolean
  lastUpdated: number
  cache: Record<string, MarketToken>
  solPrice: number
  refreshTrending: () => Promise<void>
  loadTokens: (addresses: string[], chain?: string) => Promise<MarketToken[]>
  search: (q: string) => Promise<MarketToken[]>
  put: (list: MarketToken[]) => void
}

function index(list: MarketToken[]): Record<string, MarketToken> {
  return Object.fromEntries(list.map((t) => [marketKey(t.chain, t.address), t]))
}

export const useMarket = create<MarketState>()((set, get) => ({
  trending: [],
  loading: false,
  offline: false,
  lastUpdated: 0,
  cache: {},
  solPrice: 0,

  async refreshTrending() {
    set({ loading: true })
    try {
      const list = await getTrending()
      if (!list.length) throw new Error('empty')
      const sol = list.find((t) => t.address === SOL_MINT)
      set({ trending: list, offline: false, lastUpdated: Date.now(), cache: { ...get().cache, ...index(list) }, solPrice: sol?.priceUsd || get().solPrice })
    } catch {
      // 行情接口不可达：只标记离线，列表保持原样
      set({ offline: true, lastUpdated: Date.now() })
    } finally {
      set({ loading: false })
    }
  },

  async loadTokens(addresses, chain = 'solana') {
    if (!addresses.length) return []
    try {
      const list = await getTokens(addresses, chain)
      set({ cache: { ...get().cache, ...index(list) }, offline: false })
      return list
    } catch {
      set({ offline: true })
      return []
    }
  },

  async search(q) {
    try {
      const list = await searchTokens(q)
      set({ cache: { ...get().cache, ...index(list) } })
      return list
    } catch {
      return []
    }
  },

  put(list) {
    set({ cache: { ...get().cache, ...index(list) } })
  },
}))
