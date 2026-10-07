// Report the trade record after a fill: this is the "trading is social" entry point — the server computes PnL, publishes posts, and ranks leaderboards from it
import { api } from './social'
import { chainById, isNative, isStable } from './chains'
import { useSocial } from '@/store/social'

export interface TradeReport { side: 'buy' | 'sell'; /** This fill's PnL when closing a perps position (0 at open); spot omits it — the server computes from inventory */ realized?: number; chainId: number; token: string; symbol: string; name?: string; logo?: string; qty: number; usd: number; marketCap?: number; tx?: string; /** Non-onchain markets (e.g. hyperliquid) get the identifier directly, skipping the chain-table lookup */ chainKey?: string }

/** Stablecoins and native coins don't count as "buying a coin" — only meme / altcoin buys and sells are reported */
export function isReportable(t: { address: string; symbol: string }): boolean {
  return !isNative(t.address) && !isStable(t.symbol) && !['SOL', 'ETH', 'BNB', 'WETH', 'WBNB', 'WSOL'].includes(t.symbol.toUpperCase())
}

export async function reportTrade(r: TradeReport): Promise<void> {
  if (useSocial.getState().status !== 'ready') return
  const chain = r.chainKey || chainById(r.chainId)?.dexKey
  if (!chain || !(r.qty > 0)) return
  try {
    await api('/api/trades', { method: 'POST', body: JSON.stringify({ side: r.side, realized: r.realized, chain, token: r.token, symbol: r.symbol, name: r.name, logo: r.logo, qty: r.qty, usd: r.usd, marketCap: r.marketCap, tx: r.tx }) })
  } catch { /* A failed report doesn't affect the trade itself */ }
}
