// BTC instant swap (2026-09-30 goat: "better add BTC instant swap too"). Routes through the existing cross-chain integration (lib/lifi.ts); the Bitcoin chain id = BTC_CHAIN_ID.
//
// Two directions:
//   · Buy BTC (EVM / Solana → BTC): sign the source-chain EVM / Solana tx as usual, with the user's own bc1q as the receiving address — nothing special here.
//   · Sell BTC (BTC → EVM / Solana): the cross-chain service returns a PSBT per the quote (structure verified 2026-09-30):
//       outputs = deposit address (the quote's transactionRequest.to, amount = sell amount − service flat fee)
//            + OP_RETURN memo (how the cross-chain service identifies whose funds these are and what to swap them into)
//            + change (back to the sending address)
//            + service flat fee (0.25%, topped up to the 294-sat dust line at minimum, paid to the service's fee address)
//     We never sign blindly: verify item by item (all inputs are the user's own, outputs limited to the four kinds above, amounts match the quote, miner fee capped) — reject on any mismatch,
//     then convert to the BtcSignRequest our existing signers accept (same for the iOS native vault / web layer); after signing, verify the txid is unchanged before broadcasting.
//
// Platform fee: the cross-chain service requires integrators to configure a fee address for the Bitcoin chain in its dashboard first — quoting with a fee parameter before that errors outright (measured 1011 on 2026-09-30),
// so the sell-BTC direction takes no platform fee for now (the Bitcoin source chain skips fee in lib/lifi.ts getLifiQuote); buy-BTC charges as usual on EVM / Solana source chains.
import { Address, NETWORK, OutScript, Transaction } from '@scure/btc-signer'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { LiFiStep } from '@lifi/types'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID } from './chains'
import { BTC_DUST, OP_RETURN_MAX, checkSignedBtcTx, ownBtcScript, type BtcSignRequest, type BtcSigner } from './btc'
import { broadcastBtc } from './btcApi'
import { t } from '@/lib/i18n'

export const isBtcChain = (chainId: number) => chainId === BTC_CHAIN_ID

/** Which address each chain receives / sends with during swaps: Solana uses the Solana address, Bitcoin uses bc1q, everything else (EVM) uses 0x */
export function swapAddressFor(chainId: number, a: { address?: string | null; evmAddress?: string | null; btcAddress?: string | null }): string | null {
  if (chainId === SOLANA_CHAIN_ID) return a.address || null
  if (chainId === BTC_CHAIN_ID) return a.btcAddress || null
  return a.evmAddress || null
}

/**
 * The Bitcoin address where the cross-chain service collects its flat fee (identical in two real quotes on 2026-09-30).
 * Only this one is trusted: if it ever changes, verification rejects and warns — add the new address here after confirming (better temporarily unusable than signing to an unknown address)
 */
export const BTC_SERVICE_FEE_ADDRESSES = new Set(['bc1qn2cstnjlvhxf60j3ujeyq0h0rqc7kklap8j94g'])
/**
 * Our own platform-fee receiving address (configured by goat on 2026-09-30 in the cross-chain service's dashboard for integrator 0x4's Bitcoin chain; provided by goat).
 * Sell-BTC quote txs carry one extra output here; the amount is at most BTC_PLATFORM_MAX_BPS of the sell amount (standard rate — lower VIP rates are within range)
 */
export const BTC_PLATFORM_FEE_ADDRESS = 'bc1q84npp3djxd9cczt0xnsrvegd548yp66lx839ed'
export const BTC_PLATFORM_MAX_BPS = 75n
/** Miner fee cap: 3x the quote's estimate, at least 5,000 sat allowed (quotes run low when the network is congested) */
export const BTC_MINER_FEE_FLOOR = 5_000n
/** The service flat fee may exceed the quoted figure by a few sat (quote rounding, dust-line top-up) */
const FEE_SLACK = 2n

export class BtcSwapCheckError extends Error {}

export interface BtcSwapPlan {
  request: BtcSignRequest
  unsigned: Transaction
  /** Sats to the deposit address */
  deposit: bigint
  /** Service flat fee (sat) */
  serviceFee: bigint
  /** Our platform fee (sat) */
  platformFee: bigint
  /** Change (sat) */
  change: bigint
  /** Miner fee (sat) */
  minerFee: bigint
  depositAddress: string
}

const addrOf = (script: Uint8Array): string | null => {
  try { const d = OutScript.decode(script); return d.type === 'unknown' ? null : Address(NETWORK).encode(d) } catch { return null }
}
const reject = (msg: string): never => { throw new BtcSwapCheckError(msg) }

/**
 * Verifies the sell-BTC quote transaction; on success returns a signer-ready request. Pure function — unit tests feed it real quotes.
 * @param ownAddress the user's own bc1q (all inputs must be it; change must return to it)
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
  // Inputs: all the user's own coins (P2WPKH, script matches the user's own address)
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

  // Service flat fee: the BTC-denominated flat fee in the quote; topped up to the dust line when it falls short
  const quotedFee = (step.estimate.feeCosts || [])
    .filter((f) => f.included && f.token?.chainId === BTC_CHAIN_ID && /fixed/i.test(f.name || ''))
    .reduce((s, f) => s + BigInt(f.amount || '0'), 0n)
  const P2WPKH_DUST = 294n
  // Platform fee cap (sell amount × 0.75%, rounded down); the quote's "flat fee" already includes our platform fee, so the service's own share is computed net of it
  const maxPlatformFee = value * BTC_PLATFORM_MAX_BPS / 10_000n

  let deposit = 0n, depositCount = 0, serviceFee = 0n, serviceCount = 0, platformFee = 0n, platformCount = 0, change = 0n, opReturns = 0, outTotal = 0n
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i)
    const amount = o.amount ?? 0n
    outTotal += amount
    const script = o.script!
    if (script[0] === 0x6a) {
      // OP_RETURN: at most one, carries no funds, data ≤ 80 bytes
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
  // Outgoing (deposit + service fee) must not exceed the sell amount; the deposit also can't fall far short of the amount (the shortfall may only be the service-fee part)
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

/** Sell BTC: verify → sign (native vault or web layer) → verify the signing result → broadcast; returns the Bitcoin txid */
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
