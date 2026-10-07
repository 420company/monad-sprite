// Solana 链上数据读取与交易发送
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

/** 按 RPC 地址缓存 Connection 实例 */
export function getConnection(rpcUrl: string): Connection {
  if (!cached || cached.url !== rpcUrl) {
    cached = { url: rpcUrl, conn: new Connection(rpcUrl, { commitment: 'confirmed' }) }
  }
  return cached.conn
}

export function isValidAddress(addr: string): boolean {
  try {
    // 只校验是否为合法的 base58 公钥（允许 PDA 等非曲线地址）
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

/** 读取所有 SPL 代币余额（含 Token-2022） */
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

/** 最近交易签名 */
export async function getActivity(rpcUrl: string, owner: string, limit = 25): Promise<ActivityItem[]> {
  const sigs = await getConnection(rpcUrl).getSignaturesForAddress(new PublicKey(owner), { limit })
  return sigs.map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime, err: !!s.err, memo: s.memo }))
}

/** 发送 SOL 转账 */
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

/** 签名并发送一笔版本化交易（Jupiter 返回的交易） */
/**
 * 等 Solana 交易确认：轮询签名状态 + 区块高度，不用 WebSocket（2026-10-04 修）。
 * web3.js 的 confirmTransaction 只在 WebSocket 订阅成功之后才查一次状态；网页版和插件的节点走服务器 /rpc 转发，没有 WebSocket，
 * 交易明明成功了也要一直等到过期，然后报「过期」。现在：确认了就返回；链上失败抛「交易失败」；过了有效高度还查不到 = 没上链；
 * 节点偶尔出错照常重试，连续出错太多次才放弃（这时交易可能已经成功，提示去钱包记录里看）
 */
export async function confirmSignature(conn: Pick<Connection, 'getSignatureStatuses' | 'getBlockHeight'>, sig: string, lastValidBlockHeight: number, pollMs = 1500): Promise<void> {
  let errors = 0
  for (;;) {
    try {
      const s = (await conn.getSignatureStatuses([sig])).value[0]
      if (s?.err) throw new SolTxFailed(JSON.stringify(s.err))
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return
      if (!s && (await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) {
        // 过期以后再按历史查一次，免得刚好在这之间上链
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
  // 报价里的交易带的是报价那一刻的 blockhash，用户多看几十秒再点确认就会「block height exceeded」。
  // 只要还没有别人的签名（LI.FI / Jupiter 给的都是未签名交易），签之前换成最新的 blockhash 就不会过期。
  let height = lastValidBlockHeight
  if (tx.signatures.every((sg) => sg.every((b) => b === 0))) {
    const fresh = await conn.getLatestBlockhash()
    tx.message.recentBlockhash = fresh.blockhash
    height = fresh.lastValidBlockHeight
  }
  await signer.signTransaction(tx)
  // 先模拟一遍：没有 SOL 付手续费 / 余额不够 / 路线失效的交易，网络会直接丢掉，之后只会报「过期」看不出原因。
  // 模拟能把真实原因拿到手；模拟本身失败（RPC 抽风）不拦发送。
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

/** 读取代币精度（decimals） */
export async function getMintDecimals(rpcUrl: string, mint: string): Promise<number> {
  const info = await getConnection(rpcUrl).getParsedAccountInfo(new PublicKey(mint))
  const data = info.value?.data
  if (data && typeof data === 'object' && 'parsed' in data) {
    const d = (data as { parsed?: { info?: { decimals?: number } } }).parsed?.info?.decimals
    if (typeof d === 'number') return d
  }
  throw new Error(t('无法读取代币精度'))
}
