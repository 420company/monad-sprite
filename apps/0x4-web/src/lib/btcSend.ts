// 比特币发送流程：拉 UTXO → 选币 → 构造 → 签名（原生或网页层签名器）→ 把关 → 广播。
//
// OP_RETURN 备注（opReturn）是给第二步「BTC 闪兑 / 跨链」留的口子：THORChain 这类协议要求在同一笔交易里
// 带一段备注说明换成什么、打到哪。界面暂不开放。
import { BtcPlanError, buildBtcTx, checkBtcAddress, checkSignedBtcTx, ownBtcScript, planBtcSend, type BtcSendPlan, type BtcSigner, type Utxo } from './btc'
import { broadcastBtc, getBtcUtxos } from './btcApi'
import { t } from '@/lib/i18n'

export interface BtcSendInput {
  /** 本钱包地址 */
  from: string
  to: string
  /** sat；'max' = 全部发送 */
  amount: bigint | 'max'
  /** sat/vB */
  feeRate: number
  opReturn?: Uint8Array
  /** 已经拉过的 UTXO（界面预估时拉过一次，确认时复用，免得两次结果不一样） */
  utxos?: Utxo[]
}

export function planFor(input: BtcSendInput & { utxos: Utxo[] }): BtcSendPlan {
  const dest = checkBtcAddress(input.to)
  if (!dest.ok) throw new BtcPlanError('address', dest.reason === 'testnet' ? t('这是测试网地址，只能发到比特币主网地址') : t('不是合法的比特币地址'))
  return planBtcSend({
    utxos: input.utxos, toScript: dest.script, changeScript: ownBtcScript(input.from),
    amount: input.amount, feeRate: input.feeRate, opReturn: input.opReturn,
  })
}

/** 预估：返回选币结果（手续费、找零、是否有找零），不签名 */
export async function quoteBtcSend(input: BtcSendInput): Promise<{ plan: BtcSendPlan; utxos: Utxo[] }> {
  const utxos = input.utxos ?? await getBtcUtxos(input.from)
  return { plan: planFor({ ...input, utxos }), utxos }
}

export interface BtcSendResult {
  txid: string
  plan: BtcSendPlan
  /** 签好的交易（十六进制）。广播失败时可以留着重试 */
  hex: string
}

/**
 * 发送。broadcast 可注入（测试用）；默认走后端代理广播。
 * 签名器交回的交易要过 checkSignedBtcTx：txid 必须和我们构造的一致（输入输出没被换），每个输入都签了。
 */
export async function sendBtc(signer: BtcSigner, input: BtcSendInput, broadcast: (hex: string) => Promise<string> = broadcastBtc): Promise<BtcSendResult> {
  if (signer.address !== input.from) throw new Error(t('签名器地址与钱包不一致'))
  const utxos = input.utxos ?? await getBtcUtxos(input.from)
  const plan = planFor({ ...input, utxos })
  const { tx, request } = buildBtcTx(plan, ownBtcScript(input.from))
  const signedHex = await signer.signTransaction(request)
  const { txid, hex } = checkSignedBtcTx(tx, signedHex)
  const got = await broadcast(hex)
  if (got && got !== txid) throw new Error(t('交易结果核对不一致，请到交易记录里确认'))
  return { txid, plan, hex }
}
