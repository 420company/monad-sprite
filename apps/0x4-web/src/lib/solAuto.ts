// Sprite spot full-auto · Solana edition: app / web (2026-10-04). Program contracts/solana-auto, server server/src/solAuto.ts, instruction assembly solAutoCore.ts.
// Enable: the user's own Solana wallet signs an enable (authorizing USDC to the program and stamping the 0x4 account tag in the same tx); reported to the server after landing — only counts once the server verifies on-chain.
// Disable: sign a stop (revoking the authorization), then tell the server. Vault coins can be withdrawn to the wallet anytime, even after disabling.
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

/** Enable / modify: at most perDayUsd USDC per day, valid for days days. account = the 0x4 account address (the one from server /api/me) */
export async function enableSolAuto(p: { rpcUrl: string; wallet: SolanaWallet; account: string; perDayUsd: number; days: number }): Promise<SolAutoStatus> {
  if (!(p.perDayUsd >= 1 && p.perDayUsd <= SOL_MAX_PER_DAY_USDC)) throw new Error(t('每日额度不对'))
  if (!(p.days >= 1 && p.days <= SOL_MAX_DAYS)) throw new Error(t('有效期不对'))
  const perDay = BigInt(Math.round(p.perDayUsd * 1e6))
  // 2-minute margin: signing and landing take time; expiry must not exceed the program's 90-day cap
  const until = BigInt(Math.floor(Date.now() / 1000) + p.days * 86400 - 120)
  const tag = await solAutoAccountTag(p.account)
  await signSend(p.rpcUrl, p.wallet, [solAutoEnableIx(p.wallet.publicKey, perDay, until, tag)])
  return api<SolAutoStatus>('/api/sol-auto/enable', { method: 'POST', body: JSON.stringify({ sol: p.wallet.publicKey.toBase58() }) })
}

/**
 * Disable: stop the server first (no more orders), then sign an on-chain authorization revocation with the
 * wallet. A wallet is required: with only the server stopped, the on-chain authorization survives, and
 * anyone holding a login token could re-enable without a wallet signature (2026-10-04 review #6)
 */
export async function stopSolAuto(p: { rpcUrl: string; wallet: SolanaWallet | null }): Promise<SolAutoStatus> {
  if (!p.wallet) throw new Error(t('请先解锁钱包'))
  const st = await api<SolAutoStatus>('/api/sol-auto/stop', { method: 'POST' })
  await signSend(p.rpcUrl, p.wallet, [solAutoStopIx(p.wallet.publicKey)])
  return st
}

/** Withdraw vault coins back to my wallet (creating the token account if missing). After full withdrawal, close the empty vault — the deposit is refunded */
export async function withdrawSolVault(p: { rpcUrl: string; wallet: SolanaWallet; vault: SolVault; all: boolean; amount?: bigint }): Promise<string> {
  const mint = new PublicKey(p.vault.mint), tp = new PublicKey(p.vault.tokenProgram)
  const dest = ata(p.wallet.publicKey, mint, tp)
  return signSend(p.rpcUrl, p.wallet, [
    createAssociatedTokenAccountIdempotentInstruction(p.wallet.publicKey, dest, p.wallet.publicKey, mint, tp),
    solAutoWithdrawIx(p.wallet.publicKey, mint, tp, dest, p.all ? null : p.amount ?? 0n, p.all),
  ])
}
