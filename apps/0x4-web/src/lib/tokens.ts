// 持仓 ↔ 跨链代币（ChainToken）的互相转换工具
import { NATIVE_SOL, SOLANA_CHAIN_ID, sameAddr, type ChainToken } from './chains'
import { SOL_MINT } from './mock'
import type { Holding } from './types'

/** 持仓 → LI.FI 使用的代币表示（Solana 原生 SOL 用系统程序地址表示） */
export function holdingToToken(h: Holding): ChainToken & { amount: number } {
  const address = h.chainId === SOLANA_CHAIN_ID && h.mint === SOL_MINT ? NATIVE_SOL : h.mint
  return { chainId: h.chainId, address, symbol: h.symbol, name: h.name, decimals: h.decimals, logo: h.logo, priceUsd: h.priceUsd, amount: h.amount }
}

/** 找到某个代币对应的持仓（用于显示可用余额） */
export function findHolding(holdings: Holding[], t: ChainToken): Holding | undefined {
  const mint = t.chainId === SOLANA_CHAIN_ID && t.address === NATIVE_SOL ? SOL_MINT : t.address
  return holdings.find((h) => h.chainId === t.chainId && sameAddr(h.mint, mint))
}

export const tokenKey = (t: { chainId: number; address: string }) => `${t.chainId}:${t.address.toLowerCase()}`
