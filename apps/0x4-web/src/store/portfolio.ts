// Portfolio: Solana + EVM chains + Bitcoin balances × market prices = holdings valuation; activity records
import { create } from 'zustand'
import type { ActivityItem, Holding } from '@/lib/types'
import { getActivity, getSolBalance, getTokenAccounts } from '@/lib/rpc'
import { getEvmBalances } from '@/lib/evm'
import { getLifiToken } from '@/lib/lifi'
import { BTC_CHAIN, BTC_CHAIN_ID, SOLANA_CHAIN_ID, isStable, type ChainToken } from '@/lib/chains'
import { BTC_MINT, SATS } from '@/lib/btc'
import { getBtcActivity, getBtcBalance, type BtcActivity } from '@/lib/btcApi'
import { SOL_MINT } from '@/lib/mock'
import { useMarket } from './market'
import { useSettings } from './settings'
import { useWallet } from './wallet'
import { useFavorites } from './favorites'
import { useBng } from './bng'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

interface PortfolioState {
  holdings: Holding[]
  /**
 * Bitcoin holdings live separately: swap coin-selection, approval scanning, red packets etc. treat
 * holdings as EVM / Solana assets, and BTC mixed in would break them.
 * The assets and send pages merge it into the list themselves; totalUsd already includes it.
 */
  btc: Holding | null
  btcActivity: BtcActivity[]
  totalUsd: number
  solBalance: number
  activity: ActivityItem[]
  loading: boolean
  error: string | null
  lastUpdated: number
  /** Chains whose balances were last read successfully (Solana + successful EVM chains). Auto gas top-up only judges these chains; failed chains aren't treated as 0 */
  scannedChains: number[]
  /** Whether the Bitcoin balance is freshly read this round (false = missed this round, btc carries the previous value); today's PnL only uses fresh reads */
  btcFresh: boolean
  refresh: () => Promise<void>
  refreshActivity: () => Promise<void>
}

/** Solana holdings */
async function loadSolana(rpc: string, address: string): Promise<{ holdings: Holding[]; sol: number }> {
  const [sol, tokens] = await Promise.all([getSolBalance(rpc, address), getTokenAccounts(rpc, address)])
  const mints = [SOL_MINT, ...tokens.map((t) => t.mint)]
  const market = await useMarket.getState().loadTokens(mints)
  const byMint = Object.fromEntries(market.map((m) => [m.address, m]))
  const holdings: Holding[] = [
    {
      chainId: SOLANA_CHAIN_ID,
      mint: SOL_MINT,
      amount: sol,
      decimals: 9,
      symbol: 'SOL',
      name: 'Solana',
      logo: byMint[SOL_MINT]?.logo,
      priceUsd: byMint[SOL_MINT]?.priceUsd || 0,
      valueUsd: sol * (byMint[SOL_MINT]?.priceUsd || 0),
      change24h: byMint[SOL_MINT]?.change24h,
    },
    ...tokens.map((tk) => {
      const m = byMint[tk.mint]
      return {
        chainId: SOLANA_CHAIN_ID,
        mint: tk.mint,
        amount: tk.amount,
        decimals: tk.decimals,
        symbol: m?.symbol || tk.mint.slice(0, 4),
        name: m?.name || t('未知代币'),
        logo: m?.logo,
        priceUsd: m?.priceUsd || 0,
        valueUsd: tk.amount * (m?.priceUsd || 0),
        change24h: m?.change24h,
      }
    }),
  ]
  return { holdings, sol }
}

/** Per-EVM-chain holdings: balances from chain, prices from LI.FI (stablecoins fall back to $1) */
async function loadEvm(address: string, scanned?: Set<number>): Promise<Holding[]> {
  const extra: ChainToken[] = useFavorites.getState().items
    .filter((f) => f.chainId !== SOLANA_CHAIN_ID && f.decimals !== undefined)
    .map((f) => ({ chainId: f.chainId, address: f.address, symbol: f.symbol, name: f.name, decimals: f.decimals!, logo: f.logo }))
  // Platform token BNG is always scanned
  const bng = useBng.getState().token
  if (bng) extra.push(bng)
  const balances = await getEvmBalances(address, extra, useSettings.getState().fuelChains, scanned)
  return Promise.all(
    balances.map(async (b) => {
      let price = isStable(b.symbol) ? 1 : 0
      try {
        price = (await getLifiToken(b.chainId, b.address)).priceUsd || price
      } catch {
        /* Keep the fallback value when the price API fails */
      }
      return { chainId: b.chainId, mint: b.address, amount: b.amount, decimals: b.decimals, symbol: b.symbol, name: b.name, logo: b.logo, priceUsd: price, valueUsd: b.amount * price }
    }),
  )
}

/** Bitcoin holdings: balance = confirmed + unconfirmed net change (received-but-unconfirmed counted early); prices from LI.FI (same market feed as EVM) */
async function loadBtc(address: string): Promise<Holding> {
  const [bal, price] = await Promise.all([
    getBtcBalance(address),
    getLifiToken(BTC_CHAIN_ID, BTC_MINT).then((tk) => tk.priceUsd || 0).catch(() => 0),
  ])
  const amount = Math.max(0, bal.confirmed + bal.pending) / SATS
  return {
    chainId: BTC_CHAIN_ID, mint: BTC_MINT, amount, decimals: 8, symbol: 'BTC', name: 'Bitcoin',
    logo: BTC_CHAIN.native.logo, priceUsd: price, valueUsd: amount * price,
  }
}

export const usePortfolio = create<PortfolioState>()((set, get) => ({
  holdings: [],
  btc: null,
  btcActivity: [],
  totalUsd: 0,
  solBalance: 0,
  activity: [],
  loading: false,
  error: null,
  lastUpdated: 0,
  scannedChains: [],
  btcFresh: false,

  async refresh() {
    const { address, evmAddress, btcAddress } = useWallet.getState()
    // Web external wallets (MetaMask etc., 2026-09-30) are EVM-only: skip the Solana leg
    if (!address && !evmAddress) return
    set({ loading: true, error: null })
    try {
      const rpc = useSettings.getState().rpcUrl
      // EVM / Bitcoin failures must not affect the Solana side's display — caught separately
      const scanned = new Set<number>()
      const [solRes, evmRes, btcRes] = await Promise.allSettled([
        address ? loadSolana(rpc, address) : Promise.resolve({ holdings: [] as Holding[], sol: 0 }),
        evmAddress ? loadEvm(evmAddress, scanned) : Promise.resolve([] as Holding[]),
        btcAddress ? loadBtc(btcAddress) : Promise.resolve(null),
      ])
      if (solRes.status === 'rejected') throw solRes.reason
      const holdings = [...solRes.value.holdings, ...(evmRes.status === 'fulfilled' ? evmRes.value : [])].sort((a, b) => b.valueUsd - a.valueUsd)
      // Reuse the previous Bitcoin balance when this fetch missed (address unchanged), so assets don't flicker in and out
      const prevBtc = get().btc
      const btc = btcRes.status === 'fulfilled' ? btcRes.value : (btcAddress ? prevBtc : null)
      const total = holdings.reduce((s, h) => s + h.valueUsd, 0) + (btc?.valueUsd || 0)
      set({ holdings, btc, solBalance: solRes.value.sol, totalUsd: total, lastUpdated: Date.now(), scannedChains: [...(address ? [SOLANA_CHAIN_ID] : []), ...(evmRes.status === 'fulfilled' ? scanned : [])], btcFresh: btcRes.status === 'fulfilled' && !!btcRes.value })
    } catch (e) {
      set({ error: errorText(e, t('操作失败'))})
    } finally {
      set({ loading: false })
    }
  },

  async refreshActivity() {
    const { address, btcAddress } = useWallet.getState()
    if (!address) return
    // Bitcoin records fetched separately; failure doesn't affect the Solana column
    if (btcAddress) void getBtcActivity(btcAddress).then((btcActivity) => set({ btcActivity })).catch(() => {})
    try {
      set({ activity: await getActivity(useSettings.getState().rpcUrl, address) })
    } catch (e) {
      set({ error: errorText(e, t('操作失败'))})
    }
  },
}))
