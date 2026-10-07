// 小精灵看哪些链的币（自动选币看它选的链，否则看关注的币）。全自动按链分：BNB Chain 走 AutoTradeSheet，Solana 走 SolAutoTradeSheet（2026-10-04）
import type { Fly } from './social'

export function watchesChain(f: Pick<Fly, 'params'>, chain: 'bsc' | 'solana'): boolean {
  return f.params.autoPick ? f.params.autoPick.chains.includes(chain) : f.params.tokens.some((x) => x.chain === chain)
}
