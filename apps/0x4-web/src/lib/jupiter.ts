// Jupiter aggregator: quotes + swap transaction building
// Docs: https://dev.jup.ag/docs/swap-api
import { VersionedTransaction } from '@solana/web3.js'
import type { SolanaWallet } from '@/lib/vault/signers'
import { Buffer } from 'buffer'
import { ENV } from './env'
import { fetchJson } from './http'
import { signAndSend } from './rpc'

export interface JupQuote {
  /** Added by us: the platform fee account for this quote (not a Jupiter-returned field — stripped before ordering) */
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

/** Get a quote (amount in the input token's smallest unit) */
/** fee: platform fee (see lib/fees.ts's jupiterFee — only present when the fee account's token equals the input or output token); quote and order must use the same one */
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
  // The fee account travels with the quote — pass it through unchanged when ordering (a quoted fee without an account, or vice versa, both error out)
  return params.fee && params.fee.bps > 0 ? { ...quote, feeAccount: params.fee.account } : quote
}

/** Ask Jupiter to build the transaction, then sign and send locally */
export async function executeSwap(rpcUrl: string, signer: SolanaWallet, quote: JupQuote): Promise<string> {
  const body: Record<string, unknown> = {
    quoteResponse: quote,
    userPublicKey: signer.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: false,
    // Priority fee set automatically, capped at 0.005 SOL, so transactions don't stall when the network is congested
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
