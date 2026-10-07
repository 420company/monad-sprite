// LI.FI cross-chain aggregator: any token on any chain → any token on any chain (bridge + DEX in one shot)
// Docs: https://docs.li.fi/ — the API needs no key (rate-limited); production should apply for an integrator and key
import { VersionedTransaction } from '@solana/web3.js'
import type { SolanaWallet } from '@/lib/vault/signers'
import { Buffer } from 'buffer'
import type { Account } from 'viem'
import type { LiFiStep, StatusResponse, Token as LifiToken } from '@lifi/types'
import { API_BASE, ENV } from './env'
import { fetchJson } from './http'
import { signAndSend } from './rpc'
import { ensureAllowance, sendEvmTx } from './evm'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, type ChainToken } from './chains'
import type { BtcSigner } from './btc'
import { executeBtcSwap } from './btcSwap'
import { t } from '@/lib/i18n'

const API = ENV.lifiApi
const headers: Record<string, string> = ENV.lifiApiKey ? { 'x-lifi-api-key': ENV.lifiApiKey } : {}

/**
 * Asking LI.FI: normally the browser talks to it directly (no key, rate-limited by visitor IP). When rate-limited (too much use from one egress IP gets banned ~1 hour;
 * 2026-10-05 goat's screenshot showed the swap quoting "HTTP 429 Rate limit exceeded, retry in 51 minutes"), switch to our server's fallback channel
 * /api/lifi/* (the server forwards with a key; the key never leaves the server, server/src/lifiProxy.ts), and go straight to the server for the next hour instead of hitting a 429 first.
 * Only errors when both fail, and the error is a single line of Chinese — the raw English is never thrown at the user.
 */
let viaServerUntil = 0
const BUSY = () => t('报价服务繁忙，请过几分钟再试')
async function lifiGet<T>(op: 'quote' | 'status' | 'tokens' | 'token', q: string, timeoutMs?: number): Promise<T> {
  const proxy = API_BASE ? `${API_BASE}/api/lifi/${op}${q ? `?${q}` : ''}` : ''
  const viaProxy = async () => {
    try { return await fetchJson<T>(proxy, {}, timeoutMs) } catch (e) { throw /^HTTP 429\b/.test(e instanceof Error ? e.message : '') ? new Error(BUSY()) : e }
  }
  if (proxy && Date.now() < viaServerUntil) return viaProxy()
  try {
    return await fetchJson<T>(`${API}/${op}${q ? `?${q}` : ''}`, { headers }, timeoutMs)
  } catch (e) {
    if (!/^HTTP 429\b/.test(e instanceof Error ? e.message : '')) throw e
    if (!proxy) throw new Error(BUSY())
    viaServerUntil = Date.now() + 60 * 60_000
    return viaProxy()
  }
}

export type { LiFiStep, StatusResponse }

export interface QuoteParams {
  fromChain: number
  fromToken: string
  toChain: number
  toToken: string
  /** Smallest unit */
  fromAmount: bigint
  fromAddress: string
  toAddress: string
  /** 0.01 = 1% */
  slippage: number
  order?: 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST'
  /** Platform fee (basis points, see lib/fees.ts); omitted = not charged (e.g. the BNB→USDT swap when funding perps) */
  feeBps?: number
  /** LI.FI integrator id (the 0x4 registered at portal.li.fi); fees are paid to our fee wallet against it */
  integrator?: string
  /** Also convert part of it into the destination chain's gas (in fromToken's smallest unit) */
  fromAmountForGas?: bigint
}

/** Fetch a directly executable route */
export async function getLifiQuote(p: QuoteParams): Promise<LiFiStep> {
  const q = new URLSearchParams({
    fromChain: String(p.fromChain),
    toChain: String(p.toChain),
    fromToken: p.fromToken,
    toToken: p.toToken,
    fromAmount: p.fromAmount.toString(),
    fromAddress: p.fromAddress,
    toAddress: p.toAddress,
    slippage: String(p.slippage),
    order: p.order || 'RECOMMENDED',
    integrator: p.integrator || ENV.lifiIntegrator,
  })
  // Platform fee: on 2026-09-30 the cross-chain service backend configured the fee address for the Bitcoin chain — selling BTC carries it as usual (the quoted tx gets one extra output to BTC_PLATFORM_FEE_ADDRESS, verified in lib/btcSwap.ts)
  if (p.feeBps && p.feeBps > 0 && p.integrator) q.set('fee', String(p.feeBps / 10_000))
  if (p.fromAmountForGas && p.fromAmountForGas > 0n) q.set('fromAmountForGas', p.fromAmountForGas.toString())
  return lifiGet<LiFiStep>('quote', q.toString(), 20_000)
}

export type ExecPhase = 'approving' | 'signing' | 'sent'

/** Execute the route: EVM chains approve first, then send the tx; Solana chains sign and send directly; Bitcoin goes through lib/btcSwap.ts. Returns the source-chain tx hash */
export async function executeLifiStep(
  step: LiFiStep,
  signers: { solana: SolanaWallet | null; evm: Account | null; solanaRpc: string; /** For selling BTC (verified then signed by lib/btcSwap.ts) */ btc?: BtcSigner | null },
  onPhase?: (phase: ExecPhase) => void,
  /** Emit the hash once the source-chain tx is sent (unconfirmed); the UI can show the block-explorer link early */
  onHash?: (hash: string) => void,
): Promise<string> {
  const tx = step.transactionRequest
  if (!tx) throw new Error(t('路线没有可执行的交易数据'))
  const fromChain = step.action.fromChainId

  // Initiated from Bitcoin: the cross-chain service returns a PSBT; after item-by-item verification, sign with the Bitcoin signer, broadcast, and return the Bitcoin txid (lib/btcSwap.ts)
  if (fromChain === BTC_CHAIN_ID) return executeBtcSwap(step, signers.btc ?? null, onPhase)

  if (fromChain === SOLANA_CHAIN_ID) {
    if (!signers.solana) throw new Error(t('缺少 Solana 签名密钥'))
    if (!tx.data) throw new Error(t('缺少 Solana 交易数据'))
    onPhase?.('signing')
    const vtx = VersionedTransaction.deserialize(Buffer.from(tx.data, 'base64'))
    const sig = await signAndSend(signers.solanaRpc, signers.solana, vtx)
    onPhase?.('sent')
    return sig
  }

  if (!signers.evm) throw new Error(t('缺少 EVM 签名密钥'))
  if (!chainById(fromChain)) throw new Error(t('暂不支持链 {chain}', { chain: fromChain }))
  await ensureAllowance(signers.evm, fromChain, step.action.fromToken.address, step.estimate.approvalAddress, BigInt(step.action.fromAmount), () => onPhase?.('approving'))
  onPhase?.('signing')
  const hash = await sendEvmTx(signers.evm, fromChain, {
    to: tx.to!,
    data: tx.data,
    value: tx.value !== undefined ? String(tx.value) : undefined,
    gasLimit: tx.gasLimit !== undefined ? String(tx.gasLimit) : undefined,
  }, (h) => { onPhase?.('sent'); onHash?.(h) })
  return hash
}

/** Query cross-chain transfer status (source → destination) */
export async function getLifiStatus(txHash: string, fromChain: number, toChain: number, tool?: string): Promise<StatusResponse> {
  const q = new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) })
  if (tool) q.set('bridge', tool)
  return lifiGet<StatusResponse>('status', q.toString())
}

/** Search tokens by chain (name / symbol / address) */
export async function searchLifiTokens(chainId: number | undefined, search: string, limit = 25): Promise<ChainToken[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (chainId) q.set('chains', String(chainId))
  if (search.trim()) q.set('search', search.trim())
  const res = await lifiGet<{ tokens: Record<string, LifiToken[]> }>('tokens', q.toString())
  return Object.values(res.tokens).flat().map(lifiToChainToken)
}

/** Single token info (with price) */
export async function getLifiToken(chainId: number, address: string): Promise<ChainToken> {
  const t = await lifiGet<LifiToken>('token', `chain=${chainId}&token=${encodeURIComponent(address)}`)
  return lifiToChainToken(t)
}

function lifiToChainToken(t: LifiToken): ChainToken {
  return { chainId: t.chainId, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logoURI, priceUsd: Number(t.priceUSD || 0) || undefined }
}

/** Route summary, for UI display */
export function summarizeStep(step: LiFiStep) {
  const est = step.estimate
  const feeUsd = (est.feeCosts || []).filter((f) => !f.included).reduce((s, f) => s + Number(f.amountUSD || 0), 0)
  const gasUsd = (est.gasCosts || []).reduce((s, g) => s + Number(g.amountUSD || 0), 0)
  const tools = step.includedSteps?.length ? step.includedSteps.map((s) => s.toolDetails?.name || s.tool) : [step.toolDetails?.name || step.tool]
  return {
    toAmount: BigInt(est.toAmount),
    toAmountMin: BigInt(est.toAmountMin),
    fromAmountUsd: Number(est.fromAmountUSD || 0),
    toAmountUsd: Number(est.toAmountUSD || 0),
    feeUsd,
    gasUsd,
    seconds: est.executionDuration,
    tools: [...new Set(tools)],
    crossChain: step.action.fromChainId !== step.action.toChainId,
  }
}
