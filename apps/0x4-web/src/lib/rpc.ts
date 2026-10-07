// Solana on-chain data reads and transaction sending
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import type { SolanaWallet } from '@/lib/vault/signers'
import type { ActivityItem } from './types'
import { t } from '@/lib/i18n'

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

let cached: { url: string; conn: Connection } | null = null

/** Cache Connection instances by RPC address */
export function getConnection(rpcUrl: string): Connection {
  if (!cached || cached.url !== rpcUrl) {
    cached = { url: rpcUrl, conn: new Connection(rpcUrl, { commitment: 'confirmed' }) }
  }
  return cached.conn
}

export function isValidAddress(addr: string): boolean {
  try {
    // Only validate it's a legal base58 public key (PDAs and other off-curve addresses allowed)
    return new PublicKey(addr).toBase58() === addr
  } catch {
    return false
  }
}

export async function getSolBalance(rpcUrl: string, owner: string): Promise<number> {
  const lamports = await getConnection(rpcUrl).getBalance(new PublicKey(owner))
  return lamports / LAMPORTS_PER_SOL
}

export interface RawTokenAccount {
  mint: string
  amount: number
  decimals: number
}

/** Read all SPL token balances (including Token-2022) */
export async function getTokenAccounts(rpcUrl: string, owner: string): Promise<RawTokenAccount[]> {
  const conn = getConnection(rpcUrl)
  const pk = new PublicKey(owner)
  const results = await Promise.all([
    conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM }),
    conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM }).catch(() => ({ value: [] })),
  ])
  const out: RawTokenAccount[] = []
  for (const r of results) {
    for (const acc of r.value) {
      const info = acc.account.data.parsed?.info
      const ui = info?.tokenAmount
      if (!info || !ui) continue
      const amount = Number(ui.uiAmountString ?? ui.uiAmount ?? 0)
      if (amount <= 0) continue
      out.push({ mint: info.mint, amount, decimals: ui.decimals })
    }
  }
  return out
}

/** Recent transaction signatures */
export async function getActivity(rpcUrl: string, owner: string, limit = 25): Promise<ActivityItem[]> {
  const sigs = await getConnection(rpcUrl).getSignaturesForAddress(new PublicKey(owner), { limit })
  return sigs.map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime, err: !!s.err, memo: s.memo }))
}

/** Send a SOL transfer */
export async function sendSol(rpcUrl: string, from: SolanaWallet, to: string, amountSol: number): Promise<string> {
  const conn = getConnection(rpcUrl)
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(to),
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    }),
  )
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = from.publicKey
  await from.signTransaction(tx)
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  await confirmSignature(conn, sig, lastValidBlockHeight)
  return sig
}

/** Sign and send a versioned transaction (the one Jupiter returned) */
/**
 * Waiting for Solana transaction confirmation: poll signature status + block height, no WebSocket (fixed 2026-10-04).
 * web3.js's confirmTransaction only checks status once after the WebSocket subscription succeeds; the web and extension nodes go through the server's /rpc forward, which has no WebSocket,
 * so a transaction that clearly succeeded would wait until expiry and then report "expired". Now: return once confirmed; throw "transaction failed" on on-chain failure; past the validity height with nothing found = never landed;
 * occasional node errors are retried as usual; only give up after too many consecutive errors (the transaction may already have succeeded — the message tells the user to check their wallet history)
 */
export async function confirmSignature(conn: Pick<Connection, 'getSignatureStatuses' | 'getBlockHeight'>, sig: string, lastValidBlockHeight: number, pollMs = 1500): Promise<void> {
  let errors = 0
  for (;;) {
    try {
      const s = (await conn.getSignatureStatuses([sig])).value[0]
      if (s?.err) throw new SolTxFailed(JSON.stringify(s.err))
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return
      if (!s && (await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) {
        // After expiry, check history once more — it might have landed exactly in between
        const again = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
        if (again?.err) throw new SolTxFailed(JSON.stringify(again.err))
        if (again && again.confirmationStatus !== 'processed') return
        if (!again) throw new SolTxFailed(t('交易已过期，没有上链'))
      }
      errors = 0
    } catch (e) {
      if (e instanceof SolTxFailed) throw new Error(t('交易失败：{err}', { err: e.message }))
      if (++errors >= 10) throw new Error(t('暂时查不到交易结果，请稍后在钱包记录里查看'))
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
class SolTxFailed extends Error {}

export async function signAndSend(rpcUrl: string, signer: SolanaWallet, tx: VersionedTransaction, lastValidBlockHeight?: number): Promise<string> {
  const conn = getConnection(rpcUrl)
  // The quoted transaction carries the blockhash from quote time — if the user stares at it for tens of seconds before confirming, it hits "block height exceeded".
  // As long as nobody else has signed yet (LI.FI / Jupiter both hand over unsigned transactions), swapping in the freshest blockhash before signing keeps it from expiring.
  let height = lastValidBlockHeight
  if (tx.signatures.every((sg) => sg.every((b) => b === 0))) {
    const fresh = await conn.getLatestBlockhash()
    tx.message.recentBlockhash = fresh.blockhash
    height = fresh.lastValidBlockHeight
  }
  await signer.signTransaction(tx)
  // Simulate first: transactions with no SOL for fees / insufficient balance / dead routes get dropped outright by the network, and afterwards only "expired" is reported with no cause visible.
  // Simulation gets the real reason in hand; a failed simulation itself (flaky RPC) doesn't block sending.
  try {
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
    if (sim.value.err) {
      const raw = JSON.stringify(sim.value.err) + ' ' + (sim.value.logs || []).join(' ')
      if (/InsufficientFundsForFee|insufficient lamports|insufficient funds for rent/i.test(raw)) throw new Error('钱包里没有 SOL 付手续费。Solana 上任何交易都需要一点 SOL，先充入至少 0.01 SOL')
      if (/insufficient funds|0x1\b/.test(raw)) throw new Error('余额不足，无法完成这笔交易')
      if (/slippage|0x1771|exceeds desired/i.test(raw)) throw new Error(t('价格变动超过滑点，请重新获取报价'))
      throw new Error(t('交易无法执行：{reason}', { reason: raw.slice(0, 120) }))
    }
  } catch (e) {
    if (e instanceof Error && !/simulat|fetch|network|timeout|429/i.test(e.message)) throw e
  }
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 })
  height = height ?? (await conn.getLatestBlockhash()).lastValidBlockHeight
  await confirmSignature(conn, sig, height)
  return sig
}

export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}`
export const explorerAddr = (addr: string) => `https://solscan.io/account/${addr}`

/** Read a token's decimals */
export async function getMintDecimals(rpcUrl: string, mint: string): Promise<number> {
  const info = await getConnection(rpcUrl).getParsedAccountInfo(new PublicKey(mint))
  const data = info.value?.data
  if (data && typeof data === 'object' && 'parsed' in data) {
    const d = (data as { parsed?: { info?: { decimals?: number } } }).parsed?.info?.decimals
    if (typeof d === 'number') return d
  }
  throw new Error(t('无法读取代币精度'))
}
