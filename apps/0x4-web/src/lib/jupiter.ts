// Jupiter 聚合器：报价 + 构建兑换交易
// 文档：https://dev.jup.ag/docs/swap-api
import { VersionedTransaction } from '@solana/web3.js'
import type { SolanaWallet } from '@/lib/vault/signers'
import { Buffer } from 'buffer'
import { ENV } from './env'
import { fetchJson } from './http'
import { signAndSend } from './rpc'

export interface JupQuote {
  /** 我们自己加的：这笔报价对应的平台收费账户（不是 Jupiter 返回的字段，下单前拆掉） */
  feeAccount?: string
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  priceImpactPct: string
  routePlan: { swapInfo: { label?: string; ammKey: string } ; percent: number }[]
  contextSlot?: number
  timeTaken?: number
}

interface JupSwapResponse {
  swapTransaction: string
  lastValidBlockHeight: number
  prioritizationFeeLamports?: number
}

/** 获取报价（amount 为输入代币的最小单位） */
/** fee：平台手续费（见 lib/fees.ts 的 jupiterFee，只在收费账户的币等于输入或输出币时才有）；报价和下单必须用同一个 */
export async function getQuote(params: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number; fee?: { bps: number; account: string } | null }): Promise<JupQuote> {
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: String(params.slippageBps),
    restrictIntermediateTokens: 'true',
  })
  if (params.fee && params.fee.bps > 0) q.set('platformFeeBps', String(params.fee.bps))
  const quote = await fetchJson<JupQuote>(`${ENV.jupiterApi}/swap/v1/quote?${q.toString()}`)
  // 收费账户跟着报价走，下单时原样带上（报价带了费率却不给账户，或者反过来，都会出错）
  return params.fee && params.fee.bps > 0 ? { ...quote, feeAccount: params.fee.account } : quote
}

/** 请求 Jupiter 构建交易并本地签名发送 */
export async function executeSwap(rpcUrl: string, signer: SolanaWallet, quote: JupQuote): Promise<string> {
  const body: Record<string, unknown> = {
    quoteResponse: quote,
    userPublicKey: signer.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: false,
    // 自动设置优先费，上限 0.005 SOL，避免网络拥堵时交易卡住
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 5_000_000, priorityLevel: 'high' } },
  }
  const { feeAccount, ...quoteResponse } = quote
  body.quoteResponse = quoteResponse
  if (feeAccount) body.feeAccount = feeAccount

  const res = await fetchJson<JupSwapResponse>(`${ENV.jupiterApi}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const tx = VersionedTransaction.deserialize(Buffer.from(res.swapTransaction, 'base64'))
  return signAndSend(rpcUrl, signer, tx, res.lastValidBlockHeight)
}
