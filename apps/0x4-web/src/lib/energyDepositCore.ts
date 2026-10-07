// Shared top-up rules (used by both the web src/components/energy/EnergyDeposit.tsx and desktop meetings' meet/src/live/energyDeposit.tsx).
// Depends only on viem — no other main-app code (meet imports it via relative path).
// 1 USDT = 1 energy, integers only; approve first (only this top-up's amount) then call the tipping contract's deposit. The extension verifies against the same rules (extension/src/background/energyTx.ts).
import { encodeFunctionData, erc20Abi, parseAbi, type Hex } from 'viem'

export const ENERGY_UNIT = 10n ** 18n
/** Quick amounts */
export const DEPOSIT_QUICK = [10, 50, 100, 500]
/** Per-transaction max (matches the extension's MAX_ENERGY_TX) */
export const DEPOSIT_MAX = 1_000_000_000
const GE_ABI = parseAbi(['function deposit(uint256 amount)'])

/** Input text → digits only, strip leading zeros, max 9 digits */
export const cleanDepositInput = (s: string) => s.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 9)
/** A valid top-up amount (integer, 1–1B); returns null when invalid */
export function parseDepositAmount(s: string): number | null {
  if (!/^\d{1,10}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n >= 1 && n <= DEPOSIT_MAX ? n : null
}

export interface DepositTarget { chainId?: number; usdt?: string | null; contract?: string | null; enabled?: boolean; depositsOpen?: boolean }
/** Why top-ups are closed (Chinese source text; the UI translates it); null when open */
export function depositClosedReason(me: DepositTarget | null | undefined): string | null {
  if (!me?.enabled || !me.contract || !me.usdt || !me.chainId) return '送礼暂未开放'
  if (!me.depositsOpen) return '充值暂停中，已有的能量照常可以送礼'
  return null
}

/** The two top-up transactions: approve (only this top-up's amount), deposit */
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

/** Block explorer URL for the on-chain transaction (BNB Chain mainnet only) */
export const depositTxUrl = (chainId: number | undefined, hash: string) => (chainId === 56 ? `https://bscscan.com/tx/${hash}` : null)
