// 比特币闪兑（2026-09-30 goat：「最好把比特币闪兑也一起加上」）。路由用现有的跨链集成（lib/lifi.ts），比特币链 id = BTC_CHAIN_ID。
//
// 两个方向：
//   · 买入 BTC（EVM / Solana → BTC）：源链照常签 EVM / Solana 交易，收款地址填用户自己的 bc1q，这里不用管。
//   · 卖出 BTC（BTC → EVM / Solana）：跨链服务按报价返回一份 PSBT（2026-09-30 实查结构）：
//       输出 = 存款地址（报价的 transactionRequest.to，金额 = 卖出数量 − 服务固定费）
//            + OP_RETURN 备注（跨链服务靠它认这笔钱是谁的、要换成什么）
//            + 找零（回发送地址）
//            + 服务固定费（0.25%，最少凑到 294 sat 的尘埃线，打到服务的收费地址）
//     我们不照单签：逐项核对（输入全是自己的、输出只允许上面四类、金额对得上报价、矿工费有上限），不对就拒绝，
//     再转成现有签名器认的 BtcSignRequest（iOS 原生金库 / 网页层同一套），签完核对 txid 没变再广播。
//
// 平台费：跨链服务要求集成方先在它后台给比特币链配置收费地址，没配之前带 fee 参数报价会直接报错（2026-09-30 实测 1011），
// 所以卖出 BTC 方向暂不收平台费（lib/lifi.ts getLifiQuote 里比特币源链不带 fee）；买入 BTC 在 EVM / Solana 源链照常收。
import { Address, NETWORK, OutScript, Transaction } from '@scure/btc-signer'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { LiFiStep } from '@lifi/types'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID } from './chains'
import { BTC_DUST, OP_RETURN_MAX, checkSignedBtcTx, ownBtcScript, type BtcSignRequest, type BtcSigner } from './btc'
import { broadcastBtc } from './btcApi'
import { t } from '@/lib/i18n'

export const isBtcChain = (chainId: number) => chainId === BTC_CHAIN_ID

/** 兑换时某条链用哪个地址收 / 发：Solana 用 Solana 地址，比特币用 bc1q，其余（EVM）用 0x */
export function swapAddressFor(chainId: number, a: { address?: string | null; evmAddress?: string | null; btcAddress?: string | null }): string | null {
  if (chainId === SOLANA_CHAIN_ID) return a.address || null
  if (chainId === BTC_CHAIN_ID) return a.btcAddress || null
  return a.evmAddress || null
}

/**
 * 跨链服务收固定费用的比特币地址（2026-09-30 两次真实报价里都是这个）。
 * 只认这个：如果哪天换了，核对会拒绝并提示，查实后在这里加上新地址（宁可暂时用不了，也不签给不认识的地址）
 */
export const BTC_SERVICE_FEE_ADDRESSES = new Set(['bc1qn2cstnjlvhxf60j3ujeyq0h0rqc7kklap8j94g'])
/**
 * 我们自己的平台费收款地址（2026-09-30 goat 在跨链服务后台给集成方 0x4 的比特币链配的，goat 提供）。
 * 卖出 BTC 时报价交易里多一个输出打到这里；金额最多是卖出数量的 BTC_PLATFORM_MAX_BPS（普通费率，VIP 更低也在范围内）
 */
export const BTC_PLATFORM_FEE_ADDRESS = 'bc1q84npp3djxd9cczt0xnsrvegd548yp66lx839ed'
export const BTC_PLATFORM_MAX_BPS = 75n
/** 矿工费上限：报价里预估的 3 倍，最少也允许 5,000 sat（网络拥堵时报价会偏低） */
export const BTC_MINER_FEE_FLOOR = 5_000n
/** 服务固定费最多比报价里写的多几 sat（报价取整、凑尘埃线） */
const FEE_SLACK = 2n

export class BtcSwapCheckError extends Error {}

export interface BtcSwapPlan {
  request: BtcSignRequest
  unsigned: Transaction
  /** 打到存款地址的 sat */
  deposit: bigint
  /** 服务固定费（sat） */
  serviceFee: bigint
  /** 我们的平台费（sat） */
  platformFee: bigint
  /** 找零（sat） */
  change: bigint
  /** 矿工费（sat） */
  minerFee: bigint
  depositAddress: string
}

const addrOf = (script: Uint8Array): string | null => {
  try { const d = OutScript.decode(script); return d.type === 'unknown' ? null : Address(NETWORK).encode(d) } catch { return null }
}
const reject = (msg: string): never => { throw new BtcSwapCheckError(msg) }

/**
 * 核对卖出 BTC 的报价交易，通过了返回可以交给签名器的请求。纯函数，单测直接喂真实报价。
 * @param ownAddress 用户自己的 bc1q（输入必须全是它、找零必须回它）
 */
export function checkBtcSwapPsbt(step: Pick<LiFiStep, 'action' | 'estimate' | 'transactionRequest'>, ownAddress: string): BtcSwapPlan {
  if (step.action.fromChainId !== BTC_CHAIN_ID) reject(t('这笔兑换不是从比特币发起的'))
  const req = step.transactionRequest
  if (!req?.data || !req.to) reject(t('报价缺少比特币交易数据'))
  const value = BigInt(String(req!.value ?? step.action.fromAmount))
  if (value !== BigInt(step.action.fromAmount)) reject(t('报价金额与卖出数量不一致'))
  const depositAddress = String(req!.to)

  let tx: Transaction
  try { tx = Transaction.fromPSBT(hexToBytes(String(req!.data).replace(/^0x/, '')), { allowUnknownOutputs: true }) }
  catch { return reject(t('比特币交易数据无法识别')) }

  const own = ownBtcScript(ownAddress)
  const ownHex = bytesToHex(own)
  // 输入：全部是自己的币（P2WPKH，脚本和自己的地址一致）
  if (tx.inputsLength === 0) reject(t('比特币交易没有输入'))
  let inTotal = 0n
  const prevouts: BtcSignRequest['prevouts'] = []
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i)
    const wu = inp.witnessUtxo
    if (!wu || bytesToHex(wu.script) !== ownHex) reject(t('交易里有不属于本钱包的输入'))
    inTotal += wu!.amount
    prevouts.push({ amount: wu!.amount.toString(), script: ownHex })
  }

  // 服务固定费：报价里写的比特币计价的固定费，凑不到尘埃线时按尘埃线
  const quotedFee = (step.estimate.feeCosts || [])
    .filter((f) => f.included && f.token?.chainId === BTC_CHAIN_ID && /fixed/i.test(f.name || ''))
    .reduce((s, f) => s + BigInt(f.amount || '0'), 0n)
  const P2WPKH_DUST = 294n
  // 平台费上限（卖出数量 × 0.75%，向下取整）；报价里的「固定费」把我们的平台费也算进去了，跨链服务自己那份要扣掉它再算上限
  const maxPlatformFee = value * BTC_PLATFORM_MAX_BPS / 10_000n

  let deposit = 0n, depositCount = 0, serviceFee = 0n, serviceCount = 0, platformFee = 0n, platformCount = 0, change = 0n, opReturns = 0, outTotal = 0n
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i)
    const amount = o.amount ?? 0n
    outTotal += amount
    const script = o.script!
    if (script[0] === 0x6a) {
      // OP_RETURN：只允许一个、不带钱、数据不超过 80 字节
      opReturns++
      if (opReturns > 1 || amount !== 0n || script.length > OP_RETURN_MAX + 3) reject(t('交易备注不符合要求'))
      continue
    }
    const addr = addrOf(script)
    if (!addr) reject(t('交易里有无法识别的输出'))
    if (bytesToHex(script) === ownHex) { change += amount; continue }
    if (addr === depositAddress) { deposit += amount; depositCount++; continue }
    if (BTC_SERVICE_FEE_ADDRESSES.has(addr!)) { serviceFee += amount; serviceCount++; continue }
    if (addr === BTC_PLATFORM_FEE_ADDRESS) { platformFee += amount; platformCount++; continue }
    reject(t('交易里有未知的收款地址，已拒绝'))
  }
  if (platformCount > 1 || platformFee > maxPlatformFee) reject(t('平台费与报价不一致'))
  const lifiFixed = quotedFee > platformFee ? quotedFee - platformFee : 0n
  const maxServiceFee = (lifiFixed > P2WPKH_DUST ? lifiFixed : P2WPKH_DUST) + FEE_SLACK
  if (depositCount !== 1) reject(t('交易的存款输出不符合要求'))
  if (opReturns !== 1) reject(t('交易缺少兑换备注'))
  if (serviceCount > 1 || serviceFee > maxServiceFee) reject(t('服务费与报价不一致'))
  // 发出去的（存款 + 服务费）不能超过卖出数量；存款也不能比数量少太多（少的只能是服务费那部分）
  if (deposit + serviceFee + platformFee > value + P2WPKH_DUST || deposit < value - maxServiceFee - platformFee || deposit < BTC_DUST) reject(t('存款金额与报价不一致'))
  const minerFee = inTotal - outTotal
  const estMiner = (step.estimate.gasCosts || []).filter((g) => g.token?.chainId === BTC_CHAIN_ID).reduce((s, g) => s + BigInt(g.amount || '0'), 0n)
  const cap = estMiner * 3n > BTC_MINER_FEE_FLOOR ? estMiner * 3n : BTC_MINER_FEE_FLOOR
  if (minerFee < 0n || minerFee > cap) reject(t('比特币网络手续费异常，已拒绝'))

  return {
    request: { tx: bytesToHex(tx.unsignedTx), prevouts },
    unsigned: Transaction.fromRaw(tx.unsignedTx, { allowUnknownOutputs: true }),
    deposit, serviceFee, platformFee, change, minerFee, depositAddress,
  }
}

/** 卖出 BTC：核对 → 签名（原生金库或网页层）→ 核对签名结果 → 广播，返回比特币 txid */
export async function executeBtcSwap(step: LiFiStep, signer: BtcSigner | null, onPhase?: (p: 'signing' | 'sent') => void): Promise<string> {
  if (!signer) throw new Error(t('比特币密钥不可用，请解锁钱包后再试'))
  const plan = checkBtcSwapPsbt(step, signer.address)
  onPhase?.('signing')
  const signed = await signer.signTransaction(plan.request)
  const { hex } = checkSignedBtcTx(plan.unsigned, signed)
  const txid = await broadcastBtc(hex)
  onPhase?.('sent')
  return txid
}
