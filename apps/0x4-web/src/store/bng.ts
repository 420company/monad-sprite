// 平台代币 BNG：从环境变量读地址；所在链与精度在首次启动时通过 DexScreener / 链上自动识别并缓存
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
          // 指定了链就直接用，否则在所有链上查交易对，取流动性最高的
          const chainInfo = ENV.bngChain ? chainByDexKey(ENV.bngChain) : undefined
          // 行情查不到（例如还没有交易对）不影响使用，只是没有价格
          const list = await lookupAnyChain(ENV.bngAddress).catch(() => [])
          const best = (chainInfo ? list.filter((t) => t.chainId === chainInfo.id) : list)[0]
          const chainId = best?.chainId ?? chainInfo?.id
          if (!chainId || !chainById(chainId)) return null
          let decimals = cached?.decimals ?? 18
          try { decimals = await getErc20Decimals(chainId, ENV.bngAddress) } catch { /* 读不到沿用上次或 18 */ }
          const token: ChainToken = { chainId, address: ENV.bngAddress, symbol: best?.symbol || 'BNG', name: best?.name || 'BNG', decimals, logo: best?.logo, priceUsd: best?.priceUsd }
          // 同步修正常用代币表里的精度，余额换算才准确
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
