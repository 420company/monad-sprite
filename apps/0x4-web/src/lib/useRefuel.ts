// 补燃料费的统一入口：拿当前钱包、持仓里的 BNB 价格，从 BSC 的 BNB 换目标链的燃料费（见 lib/gas.ts）
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
  /** beforeSign：报价拿到、签名之前调用（燃料费页用它请用户验证身份，面板上写着金额）；没有路线时不会走到这一步 */
  const run = useCallback(async (chainId: number, usd: number, opts: { beforeSign?: () => Promise<void> } = {}) => {
    if (!evmAccount || !evmAddress) throw new Error(t('请先解锁钱包'))
    setBusyChain(chainId)
    try {
      const hash = await refuel({ chainId, usd, bnbPriceUsd: bnb?.priceUsd || 0, bnbUsd, evm: evmAccount, solana: wallet, solanaRpc: rpcUrl, evmAddress, solanaAddress: address || '', beforeSign: opts.beforeSign })
      // 跨链到账要几秒，稍后刷新持仓
      setTimeout(() => { refresh() }, 8000)
      return hash
    } finally { setBusyChain(null) }
  }, [evmAccount, evmAddress, wallet, rpcUrl, address, bnb?.priceUsd, bnbUsd, refresh])
  /** 只报价不签名：这条链现在能不能从 BNB 补燃料费（添加链时用）。拿不到 BNB 价格或地址时不判断，返回 null */
  const checkRoute = useCallback(async (chainId: number, usd: number): Promise<boolean | null> => {
    if (!evmAddress || !(bnb?.priceUsd && bnb.priceUsd > 0)) return null
    try { await quoteRefuel({ chainId, usd, bnbPriceUsd: bnb.priceUsd, evmAddress, solanaAddress: address || '' }); return true } catch { return false }
  }, [evmAddress, address, bnb?.priceUsd])
  return { run, checkRoute, busyChain, bnbUsd }
}
