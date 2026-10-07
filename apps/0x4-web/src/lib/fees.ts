// Trading fees (set by goat 2026-09-27, priced by what the user pays in total): rates are pushed by the server per VIP status (GET /api/fees/me) — rate changes need no new build.
//   Solana spot (Jupiter): we take 1% / VIP 0.8%; EVM spot (LI.FI): we take 0.75% / VIP 0.55% (LI.FI separately takes 0.25%)
//   Perps (Aster builder): we take 0.06% / VIP 0.04% (Aster separately takes 0.04% taker)
// Regular rates apply when not logged in or the pull fails. After a fill, report the tx hash to the server for verification; VIP upgrades automatically once cumulative volume is enough.
import { create } from 'zustand'
import { api } from './social'
import { useSocial } from '@/store/social'

import { DEFAULT_FEES, type FeeState } from './feeRules'
export { DEFAULT_FEES, jupiterFee, LIFI_FEE_BPS, spotFeeLabel, type FeeState } from './feeRules'

/** account = which account these rates belong to (the home badge won't show the previous account's tier after switching wallets) */
interface Store { fees: FeeState; loadedAt: number; account: string; load: (force?: boolean) => Promise<FeeState> }
export const useFees = create<Store>((set, get) => ({
  fees: DEFAULT_FEES,
  loadedAt: 0,
  account: '',
  async load(force) {
    const soc = useSocial.getState()
    if (soc.status !== 'ready') return get().fees
    const account = soc.me?.address || ''
    if (!force && account === get().account && Date.now() - get().loadedAt < 5 * 60_000) return get().fees
    try {
      const f = await api<FeeState>('/api/fees/me')
      set({ fees: { ...DEFAULT_FEES, ...f }, loadedAt: Date.now(), account })
      // The perp order's builder fee follows along (the perp module loads on demand — kept out of the first screen)
      import('./aster').then((m) => m.setPerpFeeRate(f.perpRate)).catch(() => {})
    } catch { /* Use the last / default rates */ }
    return get().fees
  },
}))
/** Used before ordering: wait at most 3s; if nothing arrives, use what's on hand (default regular rates) */
export async function currentFees(): Promise<FeeState> {
  return Promise.race([useFees.getState().load(), new Promise<FeeState>((r) => setTimeout(() => r(useFees.getState().fees), 3000))])
}

/** Report spot fills to the server for verification (counts toward VIP volume); failure doesn't affect the trade */
export function reportFeeReceipt(via: 'jupiter' | 'lifi', tx: string) {
  if (!tx || useSocial.getState().status !== 'ready') return
  api<{ counted: number }>('/api/fees/receipt', { method: 'POST', body: JSON.stringify({ via, tx }) })
    .then((r) => { if (r.counted > 0) useFees.getState().load(true) })
    .catch(() => {})
}
