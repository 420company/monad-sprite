// 跨链聚合器 LI.FI：任意链任意代币 → 任意链任意代币（桥 + DEX 一笔完成）
// 文档：https://docs.li.fi/  接口无需 API Key（有限流），生产环境建议申请 integrator 与 key
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
 * 问 LI.FI：平时浏览器直连（不带 Key，按访客 IP 限流）。被限流（同一出口 IP 用多了会被封约 1 小时，
 * 2026-10-05 goat 截图闪兑报「HTTP 429 Rate limit exceeded, retry in 51 minutes」）就改走我们服务器的备用通道
 * /api/lifi/*（服务器带 Key 转发，Key 不出服务器，server/src/lifiProxy.ts），之后一小时都直接走服务器，不再先撞一次 429。
 * 两边都不行才报错，报错用一句中文，不把英文原文甩给用户。
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
  /** 最小单位 */
  fromAmount: bigint
  fromAddress: string
  toAddress: string
  /** 0.01 = 1% */
  slippage: number
  order?: 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST'
  /** 平台手续费（万分之几，见 lib/fees.ts）；不传 = 不收（比如合约充值时的 BNB 换 USDT） */
  feeBps?: number
  /** LI.FI 集成方标识（portal.li.fi 注册的 0x4），手续费按它打到我们的收费钱包 */
  integrator?: string
  /** 顺便把一部分换成目标链 Gas（fromToken 的最小单位） */
  fromAmountForGas?: bigint
}

/** 获取一条可直接执行的路线 */
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
  // 平台费：2026-09-30 已在跨链服务后台给比特币链配好收费地址，卖出 BTC 也照常带（报价交易里多一个打到 BTC_PLATFORM_FEE_ADDRESS 的输出，lib/btcSwap.ts 核对）
  if (p.feeBps && p.feeBps > 0 && p.integrator) q.set('fee', String(p.feeBps / 10_000))
  if (p.fromAmountForGas && p.fromAmountForGas > 0n) q.set('fromAmountForGas', p.fromAmountForGas.toString())
  return lifiGet<LiFiStep>('quote', q.toString(), 20_000)
}

export type ExecPhase = 'approving' | 'signing' | 'sent'

/** 执行路线：EVM 链先授权再发交易；Solana 链直接签名发送；比特币走 lib/btcSwap.ts。返回源链交易哈希 */
export async function executeLifiStep(
  step: LiFiStep,
  signers: { solana: SolanaWallet | null; evm: Account | null; solanaRpc: string; /** 卖出 BTC 用（lib/btcSwap.ts 核对后签名） */ btc?: BtcSigner | null },
  onPhase?: (phase: ExecPhase) => void,
  /** 源链交易发出（还没确认）时给出哈希，界面可以先放区块浏览器链接 */
  onHash?: (hash: string) => void,
): Promise<string> {
  const tx = step.transactionRequest
  if (!tx) throw new Error(t('路线没有可执行的交易数据'))
  const fromChain = step.action.fromChainId

  // 从比特币发起：跨链服务给的是 PSBT，逐项核对后用比特币签名器签、广播，返回比特币 txid（lib/btcSwap.ts）
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

/** 查询跨链转账状态（源链 → 目标链） */
export async function getLifiStatus(txHash: string, fromChain: number, toChain: number, tool?: string): Promise<StatusResponse> {
  const q = new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) })
  if (tool) q.set('bridge', tool)
  return lifiGet<StatusResponse>('status', q.toString())
}

/** 按链搜索代币（名称 / 符号 / 地址） */
export async function searchLifiTokens(chainId: number | undefined, search: string, limit = 25): Promise<ChainToken[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (chainId) q.set('chains', String(chainId))
  if (search.trim()) q.set('search', search.trim())
  const res = await lifiGet<{ tokens: Record<string, LifiToken[]> }>('tokens', q.toString())
  return Object.values(res.tokens).flat().map(lifiToChainToken)
}

/** 单个代币信息（含价格） */
export async function getLifiToken(chainId: number, address: string): Promise<ChainToken> {
  const t = await lifiGet<LifiToken>('token', `chain=${chainId}&token=${encodeURIComponent(address)}`)
  return lifiToChainToken(t)
}

function lifiToChainToken(t: LifiToken): ChainToken {
  return { chainId: t.chainId, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logoURI, priceUsd: Number(t.priceUSD || 0) || undefined }
}

/** 路线摘要，供 UI 展示 */
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
