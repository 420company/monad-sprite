// Pure data and pure functions for fee rules (split out of lib/fees.ts on 2026-09-30): the 0x4 Wallet extension's swaps charge under the same rules,
// but the extension has no app community-login state (store/social), so it can't import lib/fees.ts. The app still uses lib/fees.ts; behavior unchanged.

export interface FeeState {
  vip: boolean; solBps: number; evmBps: number; perpRate: number; perpMaxRate: number
  volume: { spot: number; perp: number }; target: { spot: number; perp: number }
  /** { token mint: our fee account for that token } */
  solFeeAccounts: Record<string, string>
  lifiIntegrator: string
}
// Fallback when the server is unreachable (matches the server's defaults; the fee accounts were created on-chain on 2026-09-27)
export const DEFAULT_FEES: FeeState = {
  vip: false, solBps: 100, evmBps: 75, perpRate: 0.0006, perpMaxRate: 0.0006,
  volume: { spot: 0, perp: 0 }, target: { spot: 100_000, perp: 2_000_000 },
  solFeeAccounts: {
    So11111111111111111111111111111111111111112: 'HQifRQHCXxb2VraWTSXjGVsRhapmHKk1PUN73p3i6NhX',
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: '5nXu6QjqioA8zphR2nyz5C6ZxtZVR7YW5Y1LYwoVQMs6',
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: '2t32pNNQun6fZJpXXCKV7dpGhxbxHbP8UVCmje3vjhxg',
  },
  lifiIntegrator: '0x4',
}

/**
 * Jupiter fees: only charged when this swap's input or output token is one we built a fee account for (SOL / USDC / USDT).
 * ★ Measured 2026-09-27 on mainnet simulation: if the fee account's token is unrelated to the swap or the account doesn't exist, the entire swap fails — so better to skip the fee than fill in something wrong
 */
export function jupiterFee(f: FeeState, inputMint: string, outputMint: string): { bps: number; account: string } | null {
  if (!(f.solBps > 0)) return null
  const account = f.solFeeAccounts[outputMint] || f.solFeeAccounts[inputMint]
  return account ? { bps: f.solBps, account } : null
}

/** LI.FI's own 0.25% per transaction (the fixed rate written in the portal); combined with ours in quote details as "how much the user pays in total" */
export const LIFI_FEE_BPS = 25
/** The "fees" line in quote details: the percentage the user pays in total for this transaction (%) */
export const spotFeeLabel = (f: FeeState, via: 'jupiter' | 'lifi') => `${((via === 'jupiter' ? f.solBps : f.evmBps + LIFI_FEE_BPS) / 100).toFixed(2).replace(/\.?0+$/, '')}%${f.vip ? ' · VIP' : ''}`

