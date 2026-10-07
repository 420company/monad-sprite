// 转账工具：SOL / SPL 代币 / EVM 原生币 / ERC20，用于打赏与发送
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import type { SolanaWallet } from '@/lib/vault/signers'
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { erc20Abi, parseUnits, type Hex, type Account } from 'viem'
import { confirmSignature, getConnection } from './rpc'
import { publicClient, walletClientFor } from './evm'
import { chainById, isNative, SOLANA_CHAIN_ID, NATIVE_SOL } from './chains'
import { SOL_MINT } from './mock'
import { t } from '@/lib/i18n'

export interface TransferParams {
  chainId: number
  /** 原生币用 NATIVE_SOL / NATIVE_EVM，SPL 用 mint，ERC20 用合约 */
  token: string
  decimals: number
  amount: string | number
  to: string
}

/** 判断 mint 属于哪个 Token 程序（Token-2022 需要不同的 programId） */
async function tokenProgramFor(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint)
  return info?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
}

export async function transferSolana(rpcUrl: string, from: SolanaWallet, p: TransferParams): Promise<string> {
  const conn = getConnection(rpcUrl)
  const to = new PublicKey(p.to)
  const tx = new Transaction()
  if (p.token === NATIVE_SOL || p.token === SOL_MINT) {
    tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(Number(p.amount) * LAMPORTS_PER_SOL) }))
  } else {
    const mint = new PublicKey(p.token)
    const program = await tokenProgramFor(conn, mint)
    const mintInfo = await getMint(conn, mint, 'confirmed', program)
    const fromAta = getAssociatedTokenAddressSync(mint, from.publicKey, false, program)
    const toAta = getAssociatedTokenAddressSync(mint, to, true, program)
    const raw = parseUnits(String(p.amount), mintInfo.decimals)
    tx.add(
      // 对方没有代币账户就顺手创建（幂等）
      createAssociatedTokenAccountIdempotentInstruction(from.publicKey, toAta, to, mint, program),
      createTransferCheckedInstruction(fromAta, mint, toAta, from.publicKey, raw, mintInfo.decimals, [], program),
    )
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = from.publicKey
  await from.signTransaction(tx)
  const sig = await conn.sendRawTransaction(tx.serialize())
  await confirmSignature(conn, sig, lastValidBlockHeight)
  return sig
}

export async function transferEvm(account: Account, p: TransferParams): Promise<string> {
  const chain = chainById(p.chainId)?.viem
  if (!chain) throw new Error(t('不支持的链'))
  // 外部钱包（网页版 MetaMask 等）由它自己签名广播，见 lib/evm.ts walletClientFor
  const wallet = await walletClientFor(account, p.chainId)
  let hash: Hex
  if (isNative(p.token)) {
    hash = await wallet.sendTransaction({ chain, to: p.to as Hex, value: parseUnits(String(p.amount), 18) })
  } else {
    hash = await wallet.writeContract({ chain, address: p.token as Hex, abi: erc20Abi, functionName: 'transfer', args: [p.to as Hex, parseUnits(String(p.amount), p.decimals)] })
  }
  const receipt = await publicClient(p.chainId).waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(t('链上交易执行失败'))
  return hash
}

/** 统一入口：按链选择签名方式 */
export async function transfer(p: TransferParams, signers: { solana: SolanaWallet | null; evm: Account | null; solanaRpc: string }): Promise<string> {
  if (p.chainId === SOLANA_CHAIN_ID) {
    if (!signers.solana) throw new Error(t('缺少 Solana 密钥'))
    return transferSolana(signers.solanaRpc, signers.solana, p)
  }
  if (!signers.evm) throw new Error(t('缺少 EVM 密钥'))
  return transferEvm(signers.evm, p)
}
