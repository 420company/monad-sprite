// Which chains' coins the sprite watches (auto-pick watches its selected chains, otherwise watched coins). Autopilot splits by chain: BNB Chain goes through AutoTradeSheet, Solana through SolAutoTradeSheet (2026-10-04)
import type { Fly } from './social'

export function watchesChain(f: Pick<Fly, 'params'>, chain: 'bsc' | 'solana'): boolean {
  return f.params.autoPick ? f.params.autoPick.chains.includes(chain) : f.params.tokens.some((x) => x.chain === chain)
}
