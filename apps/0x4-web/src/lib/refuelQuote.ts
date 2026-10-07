// 补燃料费报价的参数与校验（2026-09-29）。App 的 refuel（lib/gas.ts）和实测脚本（scripts/check-fuel-chains.ts）共用这一份，
// 保证「白名单是用 App 实际会发的同一种请求测出来的」。这里不引用带 @/ 别名或 import.meta 的模块，脚本在 node 里也能直接用。

/** 补燃料费的来源：BNB Chain 的原生 BNB */
export const REFUEL_FROM_CHAIN = 56
export const REFUEL_FROM_TOKEN = '0x0000000000000000000000000000000000000000'
export const REFUEL_SLIPPAGE = 0.03
export const REFUEL_ORDER = 'CHEAPEST' as const

/** 报价里用得到的几项（LI.FI LiFiStep 的子集） */
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

/** 请求时我们自己定的几项，报价必须原样对上（App 运行时传；实测脚本不传，只查到账那一侧） */
export interface RefuelExpect { fromAmount: string; fromAddress: string; toAddress: string }
const NATIVE_FROM = new Set(['0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])

/**
 * 这份报价能不能用来补这条链的燃料费：目标链对、到账的是这条链的原生币（燃料费币）、预计到账数量大于 0、带可执行的交易。
 * 传了 expect 还要核对出钱那一侧（2026-09-29 审查 P3）：从 BNB Chain 的原生 BNB 出、金额 / 付款地址 / 收款地址和请求一致、
 * 交易发在 BNB Chain 上、交易里带的 BNB 不超过要换的数量。
 * 返回不通过的原因，通过返回 null。
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
