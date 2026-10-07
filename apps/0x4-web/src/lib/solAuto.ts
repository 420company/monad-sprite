// 小精灵现货全自动 · Solana 版：App / 网页端（2026-10-04）。程序 contracts/solana-auto，服务器 server/src/solAuto.ts，指令拼装 solAutoCore.ts。
// 开启：用户自己的 Solana 钱包签一笔 enable（同一笔里把 USDC 授权给程序，并写上 0x4 账号标记），上链后报给服务器，服务器读链核对才算数。
// 关闭：签一笔 stop（撤销授权）再告诉服务器。保险箱里的币随时能提回钱包，关闭了也能提。
import { PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import type { SolanaWallet } from './vault/signers'
import { confirmSignature, getConnection } from './rpc'
import { api } from './social'
import { t } from './i18n'
import { ata, solAutoAccountTag, solAutoEnableIx, solAutoStopIx, solAutoWithdrawIx, SOL_MAX_DAYS, SOL_MAX_PER_DAY_USDC } from './solAutoCore'

export interface SolAutoConfig { enabled: boolean; program: string; payToken: string; payDecimals: number; maxPerDayUsd: number; maxDays: number }
export interface SolVault { mint: string; tokenProgram: string; symbol: string | null; decimals: number; amount: string }
export interface SolAutoStatus { active: boolean; sol: string | null; perDayUsd: number | null; until: number | null; stopReason: string | null; vaults?: SolVault[] }

export const solAutoConfig = () => api<SolAutoConfig>('/api/sol-auto/config')
export const solAutoStatus = () => api<SolAutoStatus>('/api/sol-auto/status')

async function signSend(rpcUrl: string, wallet: SolanaWallet, ixs: TransactionInstruction[]): Promise<string> {
  const conn = getConnection(rpcUrl)
  const tx = new Transaction().add(...ixs)
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey
  await wallet.signTransaction(tx)
  const sig = await conn.sendRawTransaction(tx.serialize())
  await confirmSignature(conn, sig, lastValidBlockHeight)
  return sig
}

/** 开启 / 修改：每天最多 perDayUsd USDC，有效 days 天。account = 0x4 账号地址（服务器 /api/me 给的那个） */
export async function enableSolAuto(p: { rpcUrl: string; wallet: SolanaWallet; account: string; perDayUsd: number; days: number }): Promise<SolAutoStatus> {
  if (!(p.perDayUsd >= 1 && p.perDayUsd <= SOL_MAX_PER_DAY_USDC)) throw new Error(t('每日额度不对'))
  if (!(p.days >= 1 && p.days <= SOL_MAX_DAYS)) throw new Error(t('有效期不对'))
  const perDay = BigInt(Math.round(p.perDayUsd * 1e6))
  // 留 2 分钟余量：签名、上链有时间差，到期时间不能超出程序的 90 天上限
  const until = BigInt(Math.floor(Date.now() / 1000) + p.days * 86400 - 120)
  const tag = await solAutoAccountTag(p.account)
  await signSend(p.rpcUrl, p.wallet, [solAutoEnableIx(p.wallet.publicKey, perDay, until, tag)])
  return api<SolAutoStatus>('/api/sol-auto/enable', { method: 'POST', body: JSON.stringify({ sol: p.wallet.publicKey.toBase58() }) })
}

/**
 * 关闭：先停服务器（不再下单），再用钱包签一笔撤销链上授权。必须有钱包：只停服务器的话链上授权还在，
 * 拿到登录令牌的人不用钱包签名就能再开起来（2026-10-04 审查 #6）
 */
export async function stopSolAuto(p: { rpcUrl: string; wallet: SolanaWallet | null }): Promise<SolAutoStatus> {
  if (!p.wallet) throw new Error(t('请先解锁钱包'))
  const st = await api<SolAutoStatus>('/api/sol-auto/stop', { method: 'POST' })
  await signSend(p.rpcUrl, p.wallet, [solAutoStopIx(p.wallet.publicKey)])
  return st
}

/** 把保险箱里的币提回自己钱包（没有这个币的账户就顺手建一个）。全部提完顺手关掉空保险箱、押金退回 */
export async function withdrawSolVault(p: { rpcUrl: string; wallet: SolanaWallet; vault: SolVault; all: boolean; amount?: bigint }): Promise<string> {
  const mint = new PublicKey(p.vault.mint), tp = new PublicKey(p.vault.tokenProgram)
  const dest = ata(p.wallet.publicKey, mint, tp)
  return signSend(p.rpcUrl, p.wallet, [
    createAssociatedTokenAccountIdempotentInstruction(p.wallet.publicKey, dest, p.wallet.publicKey, mint, tp),
    solAutoWithdrawIx(p.wallet.publicKey, mint, tp, dest, p.all ? null : p.amount ?? 0n, p.all),
  ])
}
