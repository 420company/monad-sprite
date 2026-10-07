// Bitcoin send flow: fetch UTXOs → select coins → construct → sign (native or web-layer signer) → safety check → broadcast.
//
// The OP_RETURN memo (opReturn) is a hook for step two "BTC swap / cross-chain": protocols like THORChain require the same transaction to carry
// a memo stating what to swap into and where to send. Not exposed in the UI yet.
import { BtcPlanError, buildBtcTx, checkBtcAddress, checkSignedBtcTx, ownBtcScript, planBtcSend, type BtcSendPlan, type BtcSigner, type Utxo } from './btc'
import { broadcastBtc, getBtcUtxos } from './btcApi'
import { t } from '@/lib/i18n'

export interface BtcSendInput {
  /** This wallet's address */
  from: string
  to: string
  /** sat; 'max' = send everything */
  amount: bigint | 'max'
  /** sat/vB */
  feeRate: number
  opReturn?: Uint8Array
  /** Already-fetched UTXOs (the UI fetches once for estimation, reuses at confirm — avoiding differing results between the two) */
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

/** Estimate: returns the coin-selection result (fee, change, whether change exists), without signing */
export async function quoteBtcSend(input: BtcSendInput): Promise<{ plan: BtcSendPlan; utxos: Utxo[] }> {
  const utxos = input.utxos ?? await getBtcUtxos(input.from)
  return { plan: planFor({ ...input, utxos }), utxos }
}

export interface BtcSendResult {
  txid: string
  plan: BtcSendPlan
  /** The signed transaction (hex). Kept for retry when broadcast fails */
  hex: string
}

/**
 * Send. broadcast is injectable (for tests); defaults to backend-proxy broadcast.
 * The signer's returned transaction must pass checkSignedBtcTx: the txid must match what we constructed (inputs/outputs not swapped) and every input must be signed.
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
