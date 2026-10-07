// 成交后上报交易记录：这是「交易即社交」的入口，服务端据此算盈亏、发动态、排排行榜
import { api } from './social'
import { chainById, isNative, isStable } from './chains'
import { useSocial } from '@/store/social'

export interface TradeReport { side: 'buy' | 'sell'; /** 合约平仓时这笔的盈亏（开仓给 0）；现货不传，服务端按库存算 */ realized?: number; chainId: number; token: string; symbol: string; name?: string; logo?: string; qty: number; usd: number; marketCap?: number; tx?: string; /** 非链上市场（如 hyperliquid）直接给标识，跳过链表查询 */ chainKey?: string }

/** 稳定币与原生币不算「买入某个币」，只上报 meme / 山寨币的买卖 */
export function isReportable(t: { address: string; symbol: string }): boolean {
  return !isNative(t.address) && !isStable(t.symbol) && !['SOL', 'ETH', 'BNB', 'WETH', 'WBNB', 'WSOL'].includes(t.symbol.toUpperCase())
}

export async function reportTrade(r: TradeReport): Promise<void> {
  if (useSocial.getState().status !== 'ready') return
  const chain = r.chainKey || chainById(r.chainId)?.dexKey
  if (!chain || !(r.qty > 0)) return
  try {
    await api('/api/trades', { method: 'POST', body: JSON.stringify({ side: r.side, realized: r.realized, chain, token: r.token, symbol: r.symbol, name: r.name, logo: r.logo, qty: r.qty, usd: r.usd, marketCap: r.marketCap, tx: r.tx }) })
  } catch { /* 上报失败不影响交易本身 */ }
}
