// 手续费规则的纯数据和纯函数（2026-09-30 从 lib/fees.ts 拆出来）：0x4 Wallet 插件的兑换也要按同一套规则收费，
// 但插件里没有 App 的社区登录状态（store/social），不能引 lib/fees.ts。App 仍从 lib/fees.ts 用，行为不变。

export interface FeeState {
  vip: boolean; solBps: number; evmBps: number; perpRate: number; perpMaxRate: number
  volume: { spot: number; perp: number }; target: { spot: number; perp: number }
  /** { 币的 mint: 我们在该币上的收费账户 } */
  solFeeAccounts: Record<string, string>
  lifiIntegrator: string
}
// 服务器拉不到时的兜底（和服务器默认值一致；收费账户是 2026-09-27 在链上建好的）
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
 * Jupiter 收费：只有这笔的输入币或输出币是我们建了收费账户的币（SOL / USDC / USDT）才收。
 * ★2026-09-27 主网模拟实测：收费账户的币和这笔无关、或账户没建，整笔兑换会失败 —— 所以宁可这笔不收也不能乱填
 */
export function jupiterFee(f: FeeState, inputMint: string, outputMint: string): { bps: number; account: string } | null {
  if (!(f.solBps > 0)) return null
  const account = f.solFeeAccounts[outputMint] || f.solFeeAccounts[inputMint]
  return account ? { bps: f.solBps, account } : null
}

/** LI.FI 每笔自己收的 0.25%（portal 里写的固定费率）；报价详情里和我们的合起来显示「用户总共付多少」 */
export const LIFI_FEE_BPS = 25
/** 报价详情里的「手续费」：用户这笔总共付的比例（%） */
export const spotFeeLabel = (f: FeeState, via: 'jupiter' | 'lifi') => `${((via === 'jupiter' ? f.solBps : f.evmBps + LIFI_FEE_BPS) / 100).toFixed(2).replace(/\.?0+$/, '')}%${f.vip ? ' · VIP' : ''}`

