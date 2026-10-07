// Gas top-up quote params and validation (2026-09-29). The app's refuel (lib/gas.ts) and the live-test script (scripts/check-fuel-chains.ts) share this file,
// guaranteeing "the whitelist was probed with the same request shape the app actually sends". No @/-aliased or import.meta modules here, so the script runs in node directly.

/** Gas top-up source: BNB Chain's native BNB */
export const REFUEL_FROM_CHAIN = 56
export const REFUEL_FROM_TOKEN = '0x0000000000000000000000000000000000000000'
export const REFUEL_SLIPPAGE = 0.03
export const REFUEL_ORDER = 'CHEAPEST' as const

/** Fields used from the quote (a subset of LI.FI's LiFiStep) */
export interface RefuelQuoteLike {
  action?: {
    fromChainId?: number; fromAmount?: string; fromToken?: { address?: string }; fromAddress?: string
    toChainId?: number; toToken?: { address?: string; chainId?: number }; toAddress?: string
  }
  estimate?: { toAmount?: string; toAmountUSD?: string; executionDuration?: number }
  transactionRequest?: { chainId?: number; from?: string; value?: string } | unknown
  tool?: string
}

const sameToken = (a: string, b: string) => (a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Our own request fields the quote must echo back exactly (sent by the app at runtime; the test script omits them, checking only the receiving side) */
export interface RefuelExpect { fromAmount: string; fromAddress: string; toAddress: string }
const NATIVE_FROM = new Set(['0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])

/**
 * Whether this quote can top up the chain's gas: right target chain, the received asset is the chain's
 * native (gas) coin, expected received amount > 0, and an executable transaction included.
 * With expect passed, also verify the paying side (2026-09-29 review P3): paid in BNB Chain native BNB,
 * amount / from / to match the request, the tx targets BNB Chain, and the tx's BNB doesn't exceed the
 * swap amount. Returns the failure reason, null when it passes.
 */
export function refuelQuoteProblem(q: RefuelQuoteLike | null | undefined, toChainId: number, nativeAddress: string, expect?: RefuelExpect): string | null {
  if (!q) return 'no quote'
  if (q.action?.toChainId !== toChainId) return 'wrong destination chain'
  if (expect) {
    const a = q.action || {}
    if (a.fromChainId !== REFUEL_FROM_CHAIN) return 'wrong source chain'
    if (!a.fromToken?.address || !NATIVE_FROM.has(a.fromToken.address.toLowerCase())) return 'source token is not BNB'
    if (String(a.fromAmount) !== expect.fromAmount) return 'source amount differs from request'
    if (!a.fromAddress || !sameToken(a.fromAddress, expect.fromAddress)) return 'wrong payer'
    if (!a.toAddress || !sameToken(a.toAddress, expect.toAddress)) return 'wrong recipient'
    const tx = (q.transactionRequest || {}) as { chainId?: number; from?: string; value?: string }
    if (tx.chainId !== undefined && Number(tx.chainId) !== REFUEL_FROM_CHAIN) return 'transaction on wrong chain'
    if (tx.from && !sameToken(tx.from, expect.fromAddress)) return 'transaction from wrong address'
    let value = 0n
    try { value = BigInt(tx.value || '0') } catch { return 'bad transaction value' }
    if (value > BigInt(expect.fromAmount)) return 'transaction sends more BNB than requested'
  }
  const to = q.action?.toToken?.address
  if (!to || !sameToken(to, nativeAddress)) return 'destination token is not the gas coin'
  let amount = 0n
  try { amount = BigInt(q.estimate?.toAmount || '0') } catch { amount = 0n }
  if (amount <= 0n) return 'zero estimated amount'
  if (!q.transactionRequest) return 'no executable transaction'
  return null
}
