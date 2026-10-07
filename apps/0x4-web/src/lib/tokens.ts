// Converters between holdings and cross-chain tokens (ChainToken)
import { NATIVE_SOL, SOLANA_CHAIN_ID, sameAddr, type ChainToken } from './chains'
import { SOL_MINT } from './mock'
import type { Holding } from './types'

/** Holding → LI.FI's token representation (Solana native SOL uses the system program address) */
export function holdingToToken(h: Holding): ChainToken & { amount: number } {
  const address = h.chainId === SOLANA_CHAIN_ID && h.mint === SOL_MINT ? NATIVE_SOL : h.mint
  return { chainId: h.chainId, address, symbol: h.symbol, name: h.name, decimals: h.decimals, logo: h.logo, priceUsd: h.priceUsd, amount: h.amount }
}

/** Find the holding for a token (to show available balance) */
export function findHolding(holdings: Holding[], t: ChainToken): Holding | undefined {
  const mint = t.chainId === SOLANA_CHAIN_ID && t.address === NATIVE_SOL ? SOL_MINT : t.address
  return holdings.find((h) => h.chainId === t.chainId && sameAddr(h.mint, mint))
}

export const tokenKey = (t: { chainId: number; address: string }) => `${t.chainId}:${t.address.toLowerCase()}`
