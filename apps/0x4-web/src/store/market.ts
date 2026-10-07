// Market state: trending list, search, per-coin cache (indexed by chain:address); API failures only flag offline — never paper over with fake data, which would let people decide against fake prices
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
      // Market API unreachable: flag offline only, list untouched
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
