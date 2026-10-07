// Unified gas top-up entry: takes the current wallet and the BNB price from holdings, swaps BSC BNB into the target chain's gas (see lib/gas.ts)
import { useCallback, useState } from 'react'
import { useWallet } from '@/store/wallet'
import { usePortfolio } from '@/store/portfolio'
import { useSettings } from '@/store/settings'
import { BSC, nativeUsd, quoteRefuel, refuel } from './gas'
import { isNative } from './chains'
import { t } from './i18n'

export function useRefuel() {
  const { wallet, evmAccount, address, evmAddress } = useWallet()
  const { holdings, refresh } = usePortfolio()
  const { rpcUrl } = useSettings()
  const [busyChain, setBusyChain] = useState<number | null>(null)
  const bnb = holdings.find((h) => h.chainId === BSC && isNative(h.mint))
  const bnbUsd = nativeUsd(holdings, BSC)
  /** beforeSign: called after the quote arrives and before signing (the gas page uses it to ask the user to verify identity, amount shown on the panel); never reached when there's no route */
  const run = useCallback(async (chainId: number, usd: number, opts: { beforeSign?: () => Promise<void> } = {}) => {
    if (!evmAccount || !evmAddress) throw new Error(t('请先解锁钱包'))
    setBusyChain(chainId)
    try {
      const hash = await refuel({ chainId, usd, bnbPriceUsd: bnb?.priceUsd || 0, bnbUsd, evm: evmAccount, solana: wallet, solanaRpc: rpcUrl, evmAddress, solanaAddress: address || '', beforeSign: opts.beforeSign })
      // Cross-chain arrival takes seconds — refresh holdings later
      setTimeout(() => { refresh() }, 8000)
      return hash
    } finally { setBusyChain(null) }
  }, [evmAccount, evmAddress, wallet, rpcUrl, address, bnb?.priceUsd, bnbUsd, refresh])
  /** Quote only, no signature: whether this chain can currently receive gas from BNB (used when adding a chain). Can't judge without the BNB price or address — returns null */
  const checkRoute = useCallback(async (chainId: number, usd: number): Promise<boolean | null> => {
    if (!evmAddress || !(bnb?.priceUsd && bnb.priceUsd > 0)) return null
    try { await quoteRefuel({ chainId, usd, bnbPriceUsd: bnb.priceUsd, evmAddress, solanaAddress: address || '' }); return true } catch { return false }
  }, [evmAddress, address, bnb?.priceUsd])
  return { run, checkRoute, busyChain, bnbUsd }
}
