// Platform token BNG: address from env vars; chain and decimals auto-detected via DexScreener / on-chain at first launch and cached
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ENV } from '@/lib/env'
import { lookupAnyChain } from '@/lib/market'
import { chainByDexKey, chainById, type ChainToken } from '@/lib/chains'
import { getErc20Decimals } from '@/lib/evm'

interface BngState {
  token: ChainToken | null
  detectedAt: number
  detect: () => Promise<ChainToken | null>
}

export const useBng = create<BngState>()(
  persist(
    (set, get) => ({
      token: null,
      detectedAt: 0,
      async detect() {
        if (!ENV.bngAddress) return null
        const cached = get().token
        if (cached && cached.address.toLowerCase() === ENV.bngAddress.toLowerCase() && Date.now() - get().detectedAt < 24 * 3600_000) return cached
        try {
          // Use the specified chain directly; otherwise scan all chains for pairs and take the most liquid
          const chainInfo = ENV.bngChain ? chainByDexKey(ENV.bngChain) : undefined
          // Unresolvable market data (e.g. no pairs yet) doesn't block usage — just no price
          const list = await lookupAnyChain(ENV.bngAddress).catch(() => [])
          const best = (chainInfo ? list.filter((t) => t.chainId === chainInfo.id) : list)[0]
          const chainId = best?.chainId ?? chainInfo?.id
          if (!chainId || !chainById(chainId)) return null
          let decimals = cached?.decimals ?? 18
          try { decimals = await getErc20Decimals(chainId, ENV.bngAddress) } catch { /* Reuse the last value when unreadable, else 18 */ }
          const token: ChainToken = { chainId, address: ENV.bngAddress, symbol: best?.symbol || 'BNG', name: best?.name || 'BNG', decimals, logo: best?.logo, priceUsd: best?.priceUsd }
          // Sync-fix decimals in the common-token table so balance conversions stay accurate
          const curated = chainById(chainId)?.tokens.find((t) => t.address.toLowerCase() === ENV.bngAddress.toLowerCase())
          if (curated) curated.decimals = decimals
          set({ token, detectedAt: Date.now() })
          return token
        } catch {
          return get().token
        }
      },
    }),
    { name: '0x4.bng' },
  ),
)
