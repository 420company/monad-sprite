// 充值能量的共用规则（网页版 src/components/energy/EnergyDeposit.tsx 和电脑端会议 meet/src/live/energyDeposit.tsx 共用）。
// 只依赖 viem，不引主 App 的其它代码（meet 用相对路径引进来）。
// 1 USDT = 1 能量，只收整数；先授权（只授这次要充的数量）再调打赏合约 deposit。插件那边按同样的规则核对（extension/src/background/energyTx.ts）。
import { encodeFunctionData, erc20Abi, parseAbi, type Hex } from 'viem'

export const ENERGY_UNIT = 10n ** 18n
/** 快捷数量 */
export const DEPOSIT_QUICK = [10, 50, 100, 500]
/** 单笔最多（和插件的 MAX_ENERGY_TX 一致） */
export const DEPOSIT_MAX = 1_000_000_000
const GE_ABI = parseAbi(['function deposit(uint256 amount)'])

/** 输入框文字 → 只留数字、去掉开头的 0、最多 9 位 */
export const cleanDepositInput = (s: string) => s.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 9)
/** 合法的充值数量（整数、1 ~ 10 亿），不合法返回 null */
export function parseDepositAmount(s: string): number | null {
  if (!/^\d{1,10}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n >= 1 && n <= DEPOSIT_MAX ? n : null
}

export interface DepositTarget { chainId?: number; usdt?: string | null; contract?: string | null; enabled?: boolean; depositsOpen?: boolean }
/** 充值关着的原因（中文原文，界面再翻译）；开着返回 null */
export function depositClosedReason(me: DepositTarget | null | undefined): string | null {
  if (!me?.enabled || !me.contract || !me.usdt || !me.chainId) return '送礼暂未开放'
  if (!me.depositsOpen) return '充值暂停中，已有的能量照常可以送礼'
  return null
}

/** 充值要发的两笔：授权（只授这次的数量）、存入 */
export function depositCalls(me: DepositTarget, amount: number): { chainId: number; approve: { to: Hex; data: Hex }; deposit: { to: Hex; data: Hex }; units: bigint } {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > DEPOSIT_MAX) throw new Error('只能充值整数 USDT')
  if (!me.contract || !me.usdt || !me.chainId) throw new Error('送礼暂未开放')
  const units = BigInt(amount) * ENERGY_UNIT
  return {
    chainId: me.chainId,
    units,
    approve: { to: me.usdt as Hex, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [me.contract as Hex, units] }) },
    deposit: { to: me.contract as Hex, data: encodeFunctionData({ abi: GE_ABI, functionName: 'deposit', args: [units] }) },
  }
}

/** 链上交易的浏览器地址（只给 BNB Chain 主网） */
export const depositTxUrl = (chainId: number | undefined, hash: string) => (chainId === 56 ? `https://bscscan.com/tx/${hash}` : null)
