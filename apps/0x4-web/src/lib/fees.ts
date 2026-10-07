// 交易手续费（2026-09-27 goat 定，按用户总共付多少定价）：费率由服务器按是否 VIP 下发（GET /api/fees/me），改费率不用发版。
//   Solana 现货（Jupiter）我们收 1% / VIP 0.8%；EVM 现货（LI.FI）我们收 0.75% / VIP 0.55%（LI.FI 另收 0.25%）
//   合约（Aster builder）我们收 0.06% / VIP 0.04%（Aster 吃单另收 0.04%）
// 没登录或拉取失败时按普通费率收。成交后把交易哈希报给服务器核对，累计交易额够了自动升 VIP。
import { create } from 'zustand'
import { api } from './social'
import { useSocial } from '@/store/social'

import { DEFAULT_FEES, type FeeState } from './feeRules'
export { DEFAULT_FEES, jupiterFee, LIFI_FEE_BPS, spotFeeLabel, type FeeState } from './feeRules'

/** account = 这份费率是哪个账户的（切换钱包后首页勋章不显示上一个账户的等级） */
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
      // 合约下单的 builder 费跟着更新（按需加载合约模块，不把它打进首屏）
      import('./aster').then((m) => m.setPerpFeeRate(f.perpRate)).catch(() => {})
    } catch { /* 用上次的 / 默认费率 */ }
    return get().fees
  },
}))
/** 下单前用：最多等 3 秒，拿不到就按手上的（默认普通费率） */
export async function currentFees(): Promise<FeeState> {
  return Promise.race([useFees.getState().load(), new Promise<FeeState>((r) => setTimeout(() => r(useFees.getState().fees), 3000))])
}

/** 现货成交后报给服务器核对（计入 VIP 累计额）；失败不影响交易 */
export function reportFeeReceipt(via: 'jupiter' | 'lifi', tx: string) {
  if (!tx || useSocial.getState().status !== 'ready') return
  api<{ counted: number }>('/api/fees/receipt', { method: 'POST', body: JSON.stringify({ via, tx }) })
    .then((r) => { if (r.counted > 0) useFees.getState().load(true) })
    .catch(() => {})
}
