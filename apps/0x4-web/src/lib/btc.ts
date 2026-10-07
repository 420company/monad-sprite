// 比特币（原生 BTC，主网）：派生、地址、地址校验、选币、构造交易、签名。
//
// 地址规则（2026-09-25 goat 拍板）：
//   助记词钱包 → BIP84 m/84'/0'/0'/0/0，原生隔离见证 P2WPKH（bc1q…），和 MetaMask / Trust 同一个地址
//   私钥导入的钱包（没有助记词）→ 直接用 EVM 那把 secp256k1 私钥（压缩公钥）生成 P2WPKH
//
// 私钥在哪签：iOS 在原生 Ox4Vault（BtcSigner.swift），网页版 / Android 在网页层（本文件 localBtcSigner）。
// 两边算出的地址、WIF、签名字节必须一致，测试见 btc.test.ts 与 native/Ox4Vault/Tests/.../BtcSignerTests.swift。
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { Address, NETWORK, OutScript, Script, TEST_NETWORK, Transaction, WIF, p2wpkh } from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { t } from '@/lib/i18n'

/** LI.FI 给比特币的链 id（定义在 chains.ts）。持仓、活动记录用它标识 BTC，第二步闪兑直接拿去问 LI.FI 报价 */
export { BTC_CHAIN_ID } from './chains'
/** 持仓里 BTC 的「mint」。LI.FI 的比特币原生币地址就是这个字符串 */
export const BTC_MINT = 'bitcoin'
export const BTC_PATH = "m/84'/0'/0'/0/0"
/** 尘埃阈值：低于它的输出节点不转发（找零低于它就并进手续费） */
export const BTC_DUST = 546n
/** RBF：序号小于 0xfffffffe 即可被加价替换（BIP125） */
export const RBF_SEQUENCE = 0xfffffffd
/** OP_RETURN 数据上限（节点默认的标准交易规则） */
export const OP_RETURN_MAX = 80
export const SATS = 100_000_000

// ---------- 派生与地址 ----------

/**
 * BIP39 种子 → BIP84 收款地址的私钥。accountIndex 是同一组助记词下的第几个钱包（插件多钱包，2026-10-01）：
 * 第 n 个走 m/84'/0'/n'/0/0（和 Phantom 的多账户一致）；第 0 个就是原来的 BTC_PATH，已有地址不变。
 */
export function btcKeyFromSeed(seed: Uint8Array, accountIndex = 0): Uint8Array {
  const path = accountIndex === 0 ? BTC_PATH : `m/84'/0'/${accountIndex}'/0/0`
  const key = HDKey.fromMasterSeed(seed).derive(path).privateKey
  if (!key) throw new Error(t('比特币派生失败'))
  return key
}

export function btcKeyFromMnemonic(mnemonic: string): Uint8Array {
  return btcKeyFromSeed(mnemonicToSeedSync(mnemonic.trim().toLowerCase().split(/\s+/).join(' ')))
}

/** 没有助记词的钱包：BTC 私钥就是 EVM 私钥本身 */
export function btcKeyFromEvmKey(hex: string): Uint8Array {
  const h = hex.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(t('EVM 私钥格式不对'))
  return hexToBytes(h)
}

export function btcPublicKey(priv: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(priv, true)
}

/** 收款地址：P2WPKH bc1q… */
export function btcAddressFromKey(priv: Uint8Array): string {
  return p2wpkh(btcPublicKey(priv), NETWORK).address!
}

/** WIF（主网、压缩公钥，K / L 开头），导出给别的比特币钱包用 */
export function btcWif(priv: Uint8Array): string {
  return WIF(NETWORK).encode(priv)
}

/** bc1 地址展示：前 6 后 4（shortId 的前 5 后 3 对 bc1q 太短，看不出区别） */
export function shortBtc(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ---------- 地址校验 ----------

export type BtcAddressCheck =
  | { ok: true; address: string; script: Uint8Array; type: string }
  | { ok: false; reason: 'empty' | 'testnet' | 'invalid' }

/** 收款方地址：只认主网（1… / 3… / bc1q… / bc1p…），测试网 / regtest 地址明确拒绝 */
export function checkBtcAddress(input: string): BtcAddressCheck {
  let a = input.trim()
  if (!a) return { ok: false, reason: 'empty' }
  // 二维码里的 bech32 常是全大写（BIP173 允许），统一成小写
  if (/^(BC1|TB1|BCRT1)[0-9A-Z]+$/.test(a)) a = a.toLowerCase()
  if (/^(tb1|bcrt1)/i.test(a)) return { ok: false, reason: 'testnet' }
  try {
    const decoded = Address(NETWORK).decode(a)
    return { ok: true, address: a, script: OutScript.encode(decoded), type: decoded.type }
  } catch {
    try { Address(TEST_NETWORK).decode(a); return { ok: false, reason: 'testnet' } } catch { /* 两个网络都不认 */ }
    return { ok: false, reason: 'invalid' }
  }
}

/** 解析 bitcoin: 链接（扫码得到的），返回地址和可选金额 */
export function parseBitcoinUri(input: string): { address: string; amount?: string } {
  const s = input.trim()
  if (!/^bitcoin:/i.test(s)) return { address: s }
  const [addr, query = ''] = s.slice(8).split('?')
  const amount = new URLSearchParams(query).get('amount') || undefined
  return { address: addr, amount }
}

// ---------- 金额 ----------

/** "0.001" → 100000n（sat）。最多 8 位小数，多了报错，不四舍五入 */
export function parseBtc(amount: string): bigint {
  const s = amount.trim()
  if (!/^\d+(\.\d{0,8})?$/.test(s)) throw new Error(t('金额格式不对（最多 8 位小数）'))
  const [i, f = ''] = s.split('.')
  return BigInt(i) * 100_000_000n + BigInt((f + '00000000').slice(0, 8))
}

export function formatBtc(sats: bigint | number): string {
  const v = BigInt(sats)
  const neg = v < 0n
  const abs = neg ? -v : v
  const f = (abs % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${abs / 100_000_000n}${f ? `.${f}` : ''}`
}

// ---------- 选币与手续费 ----------

export interface Utxo {
  txid: string
  vout: number
  /** sat */
  value: number
  confirmed: boolean
}

export interface BtcOutput {
  script: Uint8Array
  amount: bigint
  kind: 'to' | 'change' | 'op_return'
}

export interface BtcSendPlan {
  inputs: Utxo[]
  outputs: BtcOutput[]
  /** 发给对方的 sat（「全部发送」时是扣完手续费后的数） */
  amount: bigint
  change: bigint
  fee: bigint
  /** 预估虚拟字节（按签名最长 72 字节算，实际只会更小） */
  vsize: number
  feeRate: number
}

export class BtcPlanError extends Error {
  constructor(public code: 'insufficient' | 'dust' | 'no_utxo' | 'op_return' | 'address', message: string) { super(message) }
}

const varIntLen = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5)
const outputBytes = (script: Uint8Array) => 8 + varIntLen(script.length) + script.length
/** 一个 P2WPKH 输入的重量：非见证 41 字节×4 + 见证（项数 1 + 签名 1+72 + 公钥 1+33）= 272 WU = 68 vB */
const P2WPKH_INPUT_WU = 41 * 4 + 1 + 73 + 34

/** 按输入个数与输出脚本估算 vsize（全部输入都是本钱包的 P2WPKH） */
export function estimateVsize(inputCount: number, outputScripts: Uint8Array[]): number {
  const base = 4 + varIntLen(inputCount) + varIntLen(outputScripts.length) + outputScripts.reduce((s, o) => s + outputBytes(o), 0) + 4
  const weight = base * 4 + 2 /* 隔离见证 marker + flag */ + inputCount * P2WPKH_INPUT_WU
  return Math.ceil(weight / 4)
}

const feeFor = (vsize: number, feeRate: number) => BigInt(Math.ceil(vsize * feeRate))

/** OP_RETURN 输出脚本（跨链兑换备注用；界面暂不开放） */
export function opReturnScript(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length > OP_RETURN_MAX) throw new BtcPlanError('op_return', t('备注数据长度要在 1~80 字节'))
  return Script.encode(['RETURN', data])
}

/**
 * 选币：确认过的在前，同类按金额从大到小，凑够为止（最大优先，输入少手续费就低）。
 * amount = 'max' 是「全部发送」：花掉所有 UTXO，没有找零，对方收到 = 总额 − 手续费。
 * 找零低于 546 sat 不单独出，并进手续费。
 */
export function planBtcSend(p: {
  utxos: Utxo[]
  toScript: Uint8Array
  changeScript: Uint8Array
  amount: bigint | 'max'
  /** sat/vB */
  feeRate: number
  opReturn?: Uint8Array
}): BtcSendPlan {
  const feeRate = Math.max(1, p.feeRate)
  const extra: BtcOutput[] = p.opReturn ? [{ script: opReturnScript(p.opReturn), amount: 0n, kind: 'op_return' }] : []
  const sorted = [...p.utxos].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.value - a.value)
  if (!sorted.length) throw new BtcPlanError('no_utxo', t('比特币余额为 0'))

  if (p.amount === 'max') {
    const total = sorted.reduce((s, u) => s + BigInt(u.value), 0n)
    const vsize = estimateVsize(sorted.length, [p.toScript, ...extra.map((o) => o.script)])
    const fee = feeFor(vsize, feeRate)
    const amount = total - fee
    if (amount < BTC_DUST) throw new BtcPlanError('insufficient', t('余额不够付手续费'))
    return { inputs: sorted, outputs: [{ script: p.toScript, amount, kind: 'to' }, ...extra], amount, change: 0n, fee, vsize, feeRate }
  }

  const amount = p.amount
  if (amount < BTC_DUST) throw new BtcPlanError('dust', t('金额太小，最少 {n} sat', { n: String(BTC_DUST) }))
  const picked: Utxo[] = []
  let total = 0n
  for (const u of sorted) {
    picked.push(u)
    total += BigInt(u.value)
    // 先按「带找零」算；找零不够尘埃线就去掉找零再算一次
    const withChange = estimateVsize(picked.length, [p.toScript, p.changeScript, ...extra.map((o) => o.script)])
    const feeWith = feeFor(withChange, feeRate)
    const change = total - amount - feeWith
    if (change >= BTC_DUST) {
      return {
        inputs: picked,
        outputs: [{ script: p.toScript, amount, kind: 'to' }, ...extra, { script: p.changeScript, amount: change, kind: 'change' }],
        amount, change, fee: feeWith, vsize: withChange, feeRate,
      }
    }
    const noChange = estimateVsize(picked.length, [p.toScript, ...extra.map((o) => o.script)])
    const feeNo = feeFor(noChange, feeRate)
    if (total >= amount + feeNo) {
      // 多出来的零头（不到尘埃线）全部给矿工
      return { inputs: picked, outputs: [{ script: p.toScript, amount, kind: 'to' }, ...extra], amount, change: 0n, fee: total - amount, vsize: noChange, feeRate }
    }
  }
  throw new BtcPlanError('insufficient', t('比特币余额不足（含手续费）'))
}

// ---------- 构造与签名 ----------

/** 交给签名器的请求：未签名交易 + 每个输入花的那笔输出（金额与脚本，BIP143 签名要用） */
export interface BtcSignRequest {
  /** 未签名交易（不含见证），十六进制 */
  tx: string
  prevouts: { amount: string; script: string }[]
}

export function buildBtcTx(plan: BtcSendPlan, fromScript: Uint8Array): { tx: Transaction; request: BtcSignRequest } {
  const tx = new Transaction({ allowUnknownOutputs: true })
  for (const u of plan.inputs) {
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: fromScript, amount: BigInt(u.value) }, sequence: RBF_SEQUENCE })
  }
  for (const o of plan.outputs) tx.addOutput({ script: o.script, amount: o.amount })
  return {
    tx,
    request: {
      tx: bytesToHex(tx.unsignedTx),
      prevouts: plan.inputs.map((u) => ({ amount: String(u.value), script: bytesToHex(fromScript) })),
    },
  }
}

/** 签名器接口：网页层实现（localBtcSigner）和原生实现（signers.ts 的 nativeBtcSigner）同一套 */
export interface BtcSigner {
  address: string
  /** 返回签好的完整交易（含见证），十六进制 */
  signTransaction(req: BtcSignRequest): Promise<string>
}

/** 未签名交易 + prevouts 还原成 btc-signer 的交易对象，顺带检查每个输入花的都是自己的钱 */
function restore(req: BtcSignRequest, ownScript: Uint8Array): Transaction {
  const tx = Transaction.fromRaw(hexToBytes(req.tx), { allowUnknownOutputs: true })
  if (tx.inputsLength !== req.prevouts.length || tx.inputsLength === 0) throw new Error(t('交易输入与金额数量不一致'))
  const own = bytesToHex(ownScript)
  req.prevouts.forEach((p, i) => {
    // 只签本钱包地址上的币：别的脚本一律拒绝，防止被骗去签别人构造的输入
    if (p.script.toLowerCase() !== own) throw new Error(t('交易里有不属于本钱包的输入'))
    tx.updateInput(i, { witnessUtxo: { script: ownScript, amount: BigInt(p.amount) } }, true)
  })
  return tx
}

export function localBtcSigner(priv: Uint8Array): BtcSigner {
  const ownScript = p2wpkh(btcPublicKey(priv), NETWORK).script
  return {
    address: btcAddressFromKey(priv),
    async signTransaction(req) {
      const tx = restore(req, ownScript)
      tx.sign(priv)
      tx.finalize()
      return tx.hex
    },
  }
}

/**
 * 签名结果把关：原生（或任何签名器）交回来的交易必须和我们要签的是同一笔
 * （隔离见证的 txid 不含见证，所以 txid 相同 = 输入输出一个字节没变），且每个输入都签上了。
 */
export function checkSignedBtcTx(unsigned: Transaction, signedHex: string): { txid: string; vsize: number; hex: string } {
  const signed = Transaction.fromRaw(hexToBytes(signedHex), { allowUnknownOutputs: true })
  if (signed.id !== unsigned.id) throw new Error(t('签名后的交易与原交易不一致'))
  for (let i = 0; i < signed.inputsLength; i++) {
    const w = signed.getInput(i).finalScriptWitness
    if (!w || w.length !== 2) throw new Error(t('交易签名不完整'))
  }
  return { txid: signed.id, vsize: signed.vsize, hex: signedHex }
}

export const ownBtcScript = (address: string): Uint8Array => OutScript.encode(Address(NETWORK).decode(address))
