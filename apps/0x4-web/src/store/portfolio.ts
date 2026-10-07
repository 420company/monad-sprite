// 资产组合：Solana + EVM 各链 + 比特币余额 × 行情 = 持仓估值；活动记录
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
   * 比特币持仓单独放：holdings 被闪兑选币、授权扫描、红包等当成 EVM / Solana 资产用，BTC 混进去会出错。
   * 资产页和发送页自己把它并进列表；totalUsd 已经含它。
   */
  btc: Holding | null
  btcActivity: BtcActivity[]
  totalUsd: number
  solBalance: number
  activity: ActivityItem[]
  loading: boolean
  error: string | null
  lastUpdated: number
  /** 最近一次成功读到余额的链（Solana + 读成功的 EVM 链）。自动补充燃料费只对这些链判断余额，读失败的链不当成 0 */
  scannedChains: number[]
  /** 比特币余额这次是新读到的（false = 这次没读到，btc 是沿用上一次的）；今日盈亏只拿新读到的算 */
  btcFresh: boolean
  refresh: () => Promise<void>
  refreshActivity: () => Promise<void>
}

/** Solana 链持仓 */
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

/** EVM 各链持仓：余额来自链上，价格来自 LI.FI（稳定币兜底为 1 美元） */
async function loadEvm(address: string, scanned?: Set<number>): Promise<Holding[]> {
  const extra: ChainToken[] = useFavorites.getState().items
    .filter((f) => f.chainId !== SOLANA_CHAIN_ID && f.decimals !== undefined)
    .map((f) => ({ chainId: f.chainId, address: f.address, symbol: f.symbol, name: f.name, decimals: f.decimals!, logo: f.logo }))
  // 平台代币 BNG 永远纳入扫描
  const bng = useBng.getState().token
  if (bng) extra.push(bng)
  const balances = await getEvmBalances(address, extra, useSettings.getState().fuelChains, scanned)
  return Promise.all(
    balances.map(async (b) => {
      let price = isStable(b.symbol) ? 1 : 0
      try {
        price = (await getLifiToken(b.chainId, b.address)).priceUsd || price
      } catch {
        /* 价格接口失败时保留兜底值 */
      }
      return { chainId: b.chainId, mint: b.address, amount: b.amount, decimals: b.decimals, symbol: b.symbol, name: b.name, logo: b.logo, priceUsd: price, valueUsd: b.amount * price }
    }),
  )
}

/** 比特币持仓：余额 = 已确认 + 未确认净变化（收到还没确认的也先算上）；价格用 LI.FI（和 EVM 同一套行情） */
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
    // 网页版外部钱包（MetaMask 等，2026-09-30）只有 EVM 地址：Solana 那一路跳过
    if (!address && !evmAddress) return
    set({ loading: true, error: null })
    try {
      const rpc = useSettings.getState().rpcUrl
      // EVM 链、比特币失败不应影响 Solana 侧展示，所以分别捕获
      const scanned = new Set<number>()
      const [solRes, evmRes, btcRes] = await Promise.allSettled([
        address ? loadSolana(rpc, address) : Promise.resolve({ holdings: [] as Holding[], sol: 0 }),
        evmAddress ? loadEvm(evmAddress, scanned) : Promise.resolve([] as Holding[]),
        btcAddress ? loadBtc(btcAddress) : Promise.resolve(null),
      ])
      if (solRes.status === 'rejected') throw solRes.reason
      const holdings = [...solRes.value.holdings, ...(evmRes.status === 'fulfilled' ? evmRes.value : [])].sort((a, b) => b.valueUsd - a.valueUsd)
      // 比特币这次没拉到就沿用上一次的（地址没变的前提下），不让资产忽有忽无
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
    // 比特币记录单独拉，失败不影响 Solana 那一栏
    if (btcAddress) void getBtcActivity(btcAddress).then((btcActivity) => set({ btcActivity })).catch(() => {})
    try {
      set({ activity: await getActivity(useSettings.getState().rpcUrl, address) })
    } catch (e) {
      set({ error: errorText(e, t('操作失败'))})
    }
  },
}))
