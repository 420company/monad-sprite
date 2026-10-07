// @vitest-environment jsdom
// BTC instant swap: item-by-item verification of the cross-chain service's PSBT when selling BTC (2026-09-30).
// The sample is a real quote (__fixtures__/lifi-btc-sell-quote.json: public address 0.001 BTC → BNB Chain USDT — quoted only, never signed or broadcast),
// first confirm the real quote passes, then tamper item by item — every variant must be rejected.
import { describe, expect, it } from 'vitest'
import { Address, NETWORK, OutScript, Script, Transaction } from '@scure/btc-signer'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { LiFiStep } from '@lifi/types'
import quote from './__fixtures__/lifi-btc-sell-quote.json'
import quoteFee from './__fixtures__/lifi-btc-sell-quote-fee.json'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID } from './chains'
import { BTC_PLATFORM_FEE_ADDRESS, BtcSwapCheckError, checkBtcSwapPsbt, isBtcChain, swapAddressFor } from './btcSwap'

const step = quote as unknown as LiFiStep
/** The sending address in the quote (all inputs sit on it) */
const OWNER = step.action.fromAddress as string
const OTHER = 'bc1q4qw42stdzjqs59xvlrlxr8526e3nunw7mp73te'
const script = (addr: string) => OutScript.encode(Address(NETWORK).decode(addr))

/** Unpack the sample PSBT, repack it into a new quote with outputs edited per edit */
function mutate(edit: (outs: { script: Uint8Array; amount: bigint }[]) => { script: Uint8Array; amount: bigint }[], patch: Partial<LiFiStep['transactionRequest']> = {}): LiFiStep {
  const orig = Transaction.fromPSBT(hexToBytes(String(step.transactionRequest!.data)), { allowUnknownOutputs: true })
  const tx = new Transaction({ allowUnknownOutputs: true })
  for (let i = 0; i < orig.inputsLength; i++) {
    const inp = orig.getInput(i)
    tx.addInput({ txid: inp.txid!, index: inp.index!, witnessUtxo: inp.witnessUtxo!, sequence: inp.sequence })
  }
  const outs: { script: Uint8Array; amount: bigint }[] = []
  for (let i = 0; i < orig.outputsLength; i++) { const o = orig.getOutput(i); outs.push({ script: o.script!, amount: o.amount ?? 0n }) }
  for (const o of edit(outs)) tx.addOutput(o)
  return { ...step, transactionRequest: { ...step.transactionRequest, data: bytesToHex(tx.toPSBT()), ...patch } } as LiFiStep
}
const expectReject = (s: LiFiStep, owner = OWNER) => expect(() => checkBtcSwapPsbt(s, owner)).toThrow(BtcSwapCheckError)

describe('checkBtcSwapPsbt', () => {
  it('真实报价：通过，拆出存款 / 服务费 / 找零 / 矿工费', () => {
    const p = checkBtcSwapPsbt(step, OWNER)
    expect(p.depositAddress).toBe(step.transactionRequest!.to)
    expect(p.deposit).toBe(99_750n)          // 100,000 − service flat fee 250
    expect(p.serviceFee).toBe(294n)          // 250 topped up to the dust line 294
    expect(p.minerFee).toBeGreaterThan(0n)
    expect(p.minerFee).toBeLessThanOrEqual(5_000n)
    expect(p.request.prevouts.length).toBeGreaterThan(0)
    // The unsigned tx in the signing request is this PSBT's transaction (txid matches)
    expect(Transaction.fromRaw(hexToBytes(p.request.tx), { allowUnknownOutputs: true }).id).toBe(p.unsigned.id)
  })

  it('对照：原样重新打包（不改任何输出）照样通过，下面的拒绝都是篡改本身造成的', () => {
    expect(checkBtcSwapPsbt(mutate((outs) => outs), OWNER).deposit).toBe(99_750n)
  })

  it('输入不是自己的：拒绝', () => expectReject(step, OTHER))

  it('不是从比特币发起的报价：拒绝', () => {
    expect(() => checkBtcSwapPsbt({ ...step, action: { ...step.action, fromChainId: 56 } } as LiFiStep, OWNER)).toThrow(BtcSwapCheckError)
  })

  it('存款金额被加大（多扣用户的钱）：拒绝', () => {
    expectReject(mutate((outs) => outs.map((o) => (o.amount === 99_750n ? { ...o, amount: 150_000n } : o))))
  })

  it('找零被改到别人的地址：拒绝', () => {
    const own = bytesToHex(script(OWNER))
    expectReject(mutate((outs) => outs.map((o) => (bytesToHex(o.script) === own ? { ...o, script: script(OTHER) } : o))))
  })

  it('多出一个打给陌生地址的输出：拒绝', () => {
    expectReject(mutate((outs) => [...outs, { script: script(OTHER), amount: 1_000n }]))
  })

  it('服务费被加大：拒绝', () => {
    expectReject(mutate((outs) => outs.map((o) => (o.amount === 294n ? { ...o, amount: 5_000n } : o))))
  })

  it('两个 OP_RETURN / 没有 OP_RETURN：拒绝', () => {
    const memo = Script.encode(['RETURN', new TextEncoder().encode('x')])
    expectReject(mutate((outs) => [...outs, { script: memo, amount: 0n }]))
    expectReject(mutate((outs) => outs.filter((o) => o.script[0] !== 0x6a)))
  })

  it('矿工费异常高（找零被少给）：拒绝', () => {
    const own = bytesToHex(script(OWNER))
    expectReject(mutate((outs) => outs.map((o) => (bytesToHex(o.script) === own ? { ...o, amount: o.amount - 100_000n } : o))))
  })

  it('存款地址和报价写的不一致：拒绝', () => {
    expectReject({ ...step, transactionRequest: { ...step.transactionRequest, to: OTHER } } as LiFiStep)
  })

  it('报价金额和卖出数量不一致：拒绝', () => {
    expectReject({ ...step, transactionRequest: { ...step.transactionRequest, value: '200000' } } as LiFiStep)
  })
})

describe('swapAddressFor / isBtcChain', () => {
  it('按链取地址', () => {
    const a = { address: 'SoLAddr', evmAddress: '0xabc', btcAddress: 'bc1qxyz' }
    expect(swapAddressFor(SOLANA_CHAIN_ID, a)).toBe('SoLAddr')
    expect(swapAddressFor(BTC_CHAIN_ID, a)).toBe('bc1qxyz')
    expect(swapAddressFor(56, a)).toBe('0xabc')
    expect(swapAddressFor(BTC_CHAIN_ID, { evmAddress: '0xabc' })).toBeNull()
    expect(isBtcChain(BTC_CHAIN_ID)).toBe(true)
    expect(isBtcChain(56)).toBe(false)
  })
})

// 2026-09-30 real quote (with 0.75% platform fee, after goat configured the Bitcoin chain fee address): the tx carries one extra output to our fee address
describe('卖出 BTC 带平台费', () => {
  const stepFee = quoteFee as unknown as LiFiStep
  const ownerFee = stepFee.action.fromAddress as string
  it('真实报价通过：平台费 750 sat 打到我们的收费地址', () => {
    const plan = checkBtcSwapPsbt(stepFee, ownerFee)
    expect(plan.platformFee).toBe(750n)
    expect(plan.serviceFee).toBe(294n)
  })
  const mutate = (fn: (tx: Transaction) => void) => {
    const req = stepFee.transactionRequest!
    const tx = Transaction.fromPSBT(hexToBytes(String(req.data).replace(/^0x/, '')), { allowUnknownOutputs: true })
    fn(tx)
    return { ...stepFee, transactionRequest: { ...req, data: bytesToHex(tx.toPSBT()) } } as unknown as LiFiStep
  }
  const outIndex = (tx: Transaction, addr: string) => { for (let i = 0; i < tx.outputsLength; i++) { try { if (Address(NETWORK).encode(OutScript.decode(tx.getOutput(i).script!)) === addr) return i } catch { /* OP_RETURN */ } } return -1 }
  it('平台费超过 0.75% 被拒', () => {
    const bad = mutate((tx) => { const i = outIndex(tx, BTC_PLATFORM_FEE_ADDRESS); tx.updateOutput(i, { amount: 5_000n }) })
    expect(() => checkBtcSwapPsbt(bad, ownerFee)).toThrow(BtcSwapCheckError)
  })
  it('平台费改打到别的地址被拒', () => {
    const bad = mutate((tx) => { const i = outIndex(tx, BTC_PLATFORM_FEE_ADDRESS); tx.updateOutput(i, { script: OutScript.encode(Address(NETWORK).decode('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')) }) })
    expect(() => checkBtcSwapPsbt(bad, ownerFee)).toThrow(BtcSwapCheckError)
  })
  it('跨链服务的服务费不能借平台费的额度多拿（固定费里扣掉平台费后再算上限）', () => {
    const bad = mutate((tx) => { const i = outIndex(tx, 'bc1qn2cstnjlvhxf60j3ujeyq0h0rqc7kklap8j94g'); tx.updateOutput(i, { amount: 900n }) })
    expect(() => checkBtcSwapPsbt(bad, ownerFee)).toThrow(BtcSwapCheckError)
  })
})
