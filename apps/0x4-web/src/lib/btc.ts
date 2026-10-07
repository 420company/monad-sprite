// Bitcoin (native BTC, mainnet): key derivation, addresses, address validation, coin selection, tx building, signing.
//
// Address rules (decided by goat, 2026-09-25):
//   Mnemonic wallets → BIP84 m/84'/0'/0'/0/0, native segwit P2WPKH (bc1q…), same address as MetaMask / Trust
//   Imported-private-key wallets (no mnemonic) → derive P2WPKH directly from the EVM secp256k1 key (compressed pubkey)
//
// Where private keys sign: iOS in native Ox4Vault (BtcSigner.swift); web / Android in the web layer (localBtcSigner in this file).
// Both sides must produce identical addresses, WIFs, and signature bytes; tests in btc.test.ts and native/Ox4Vault/Tests/.../BtcSignerTests.swift.
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { Address, NETWORK, OutScript, Script, TEST_NETWORK, Transaction, WIF, p2wpkh } from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { t } from '@/lib/i18n'

/** LI.FI's chain id for Bitcoin (defined in chains.ts). Holdings and activity records use it to identify BTC; the second swap step quotes LI.FI with it directly */
export { BTC_CHAIN_ID } from './chains'
/** BTC's "mint" in holdings. This string is LI.FI's native-Bitcoin address */
export const BTC_MINT = 'bitcoin'
export const BTC_PATH = "m/84'/0'/0'/0/0"
/** Dust threshold: outputs below it aren't relayed (change below it is folded into the fee) */
export const BTC_DUST = 546n
/** RBF: sequence numbers below 0xfffffffe are replaceable-by-fee (BIP125) */
export const RBF_SEQUENCE = 0xfffffffd
/** OP_RETURN data cap (nodes' default standard-tx policy) */
export const OP_RETURN_MAX = 80
export const SATS = 100_000_000

// ---------- Derivation & addresses ----------

/**
 * BIP39 seed → private key for the BIP84 receive address. accountIndex is the wallet index under one
 * mnemonic (extension multi-wallet, 2026-10-01): wallet n uses m/84'/0'/n'/0/0 (same as Phantom's
 * multi-account); wallet 0 is the original BTC_PATH, existing addresses unchanged.
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

/** Wallets without a mnemonic: the BTC private key IS the EVM private key */
export function btcKeyFromEvmKey(hex: string): Uint8Array {
  const h = hex.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(t('EVM 私钥格式不对'))
  return hexToBytes(h)
}

export function btcPublicKey(priv: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(priv, true)
}

/** Receive address: P2WPKH bc1q… */
export function btcAddressFromKey(priv: Uint8Array): string {
  return p2wpkh(btcPublicKey(priv), NETWORK).address!
}

/** WIF (mainnet, compressed pubkey, K / L prefix), for exporting to other Bitcoin wallets */
export function btcWif(priv: Uint8Array): string {
  return WIF(NETWORK).encode(priv)
}

/** bc1 address display: first 6 + last 4 (shortId's first-5/last-3 is too short for bc1q to tell apart) */
export function shortBtc(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ---------- Address validation ----------

export type BtcAddressCheck =
  | { ok: true; address: string; script: Uint8Array; type: string }
  | { ok: false; reason: 'empty' | 'testnet' | 'invalid' }

/** Recipient address: mainnet only (1… / 3… / bc1q… / bc1p…); testnet / regtest addresses explicitly rejected */
export function checkBtcAddress(input: string): BtcAddressCheck {
  let a = input.trim()
  if (!a) return { ok: false, reason: 'empty' }
  // bech32 in QR codes is often all-uppercase (BIP173 allows it); normalize to lowercase
  if (/^(BC1|TB1|BCRT1)[0-9A-Z]+$/.test(a)) a = a.toLowerCase()
  if (/^(tb1|bcrt1)/i.test(a)) return { ok: false, reason: 'testnet' }
  try {
    const decoded = Address(NETWORK).decode(a)
    return { ok: true, address: a, script: OutScript.encode(decoded), type: decoded.type }
  } catch {
    try { Address(TEST_NETWORK).decode(a); return { ok: false, reason: 'testnet' } } catch { /* Recognized by neither network */ }
    return { ok: false, reason: 'invalid' }
  }
}

/** Parse a bitcoin: link (from QR scans); returns the address and optional amount */
export function parseBitcoinUri(input: string): { address: string; amount?: string } {
  const s = input.trim()
  if (!/^bitcoin:/i.test(s)) return { address: s }
  const [addr, query = ''] = s.slice(8).split('?')
  const amount = new URLSearchParams(query).get('amount') || undefined
  return { address: addr, amount }
}

// ---------- Amounts ----------

/** "0.001" → 100000n (sat). Max 8 decimals; more is an error, never rounded */
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

// ---------- Coin selection & fees ----------

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
  /** sats sent to the recipient ("send all" = amount after fees) */
  amount: bigint
  change: bigint
  fee: bigint
  /** Estimated virtual bytes (assumes worst-case 72-byte signatures; actual is only smaller) */
  vsize: number
  feeRate: number
}

export class BtcPlanError extends Error {
  constructor(public code: 'insufficient' | 'dust' | 'no_utxo' | 'op_return' | 'address', message: string) { super(message) }
}

const varIntLen = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5)
const outputBytes = (script: Uint8Array) => 8 + varIntLen(script.length) + script.length
/** Weight of one P2WPKH input: non-witness 41 bytes × 4 + witness (item count 1 + sig 1+72 + pubkey 1+33) = 272 WU = 68 vB */
const P2WPKH_INPUT_WU = 41 * 4 + 1 + 73 + 34

/** Estimate vsize from input count and output scripts (all inputs are this wallet's P2WPKH) */
export function estimateVsize(inputCount: number, outputScripts: Uint8Array[]): number {
  const base = 4 + varIntLen(inputCount) + varIntLen(outputScripts.length) + outputScripts.reduce((s, o) => s + outputBytes(o), 0) + 4
  const weight = base * 4 + 2 /* Segwit marker + flag */ + inputCount * P2WPKH_INPUT_WU
  return Math.ceil(weight / 4)
}

const feeFor = (vsize: number, feeRate: number) => BigInt(Math.ceil(vsize * feeRate))

/** OP_RETURN output script (for cross-chain swap memos; not exposed in UI yet) */
export function opReturnScript(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length > OP_RETURN_MAX) throw new BtcPlanError('op_return', t('备注数据长度要在 1~80 字节'))
  return Script.encode(['RETURN', data])
}

/**
 * Coin selection: confirmed first, then largest-first within the same class, until covered (fewer inputs =
 * lower fees). amount = 'max' is "send all": spend every UTXO, no change; the recipient gets total − fee.
 * Change below 546 sat isn't emitted separately — folded into the fee.
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
    // First estimate with change; if change is below dust, drop the change output and re-estimate
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
      // Leftover dust (below the dust line) all goes to miners
      return { inputs: picked, outputs: [{ script: p.toScript, amount, kind: 'to' }, ...extra], amount, change: 0n, fee: total - amount, vsize: noChange, feeRate }
    }
  }
  throw new BtcPlanError('insufficient', t('比特币余额不足（含手续费）'))
}

// ---------- Building & signing ----------

/** Signer request: unsigned tx + the prevout each input spends (amount and script, needed for BIP143 signing) */
export interface BtcSignRequest {
  /** Unsigned transaction (no witness), hex */
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

/** Signer interface: the web implementation (localBtcSigner) and the native one (signers.ts's nativeBtcSigner) share it */
export interface BtcSigner {
  address: string
  /** Returns the fully signed transaction (with witness), hex */
  signTransaction(req: BtcSignRequest): Promise<string>
}

/** Rebuild the unsigned tx + prevouts into a btc-signer transaction, verifying each input spends our own coins */
function restore(req: BtcSignRequest, ownScript: Uint8Array): Transaction {
  const tx = Transaction.fromRaw(hexToBytes(req.tx), { allowUnknownOutputs: true })
  if (tx.inputsLength !== req.prevouts.length || tx.inputsLength === 0) throw new Error(t('交易输入与金额数量不一致'))
  const own = bytesToHex(ownScript)
  req.prevouts.forEach((p, i) => {
    // Only sign coins on this wallet's addresses: any other script is rejected, so nobody tricks us into signing their crafted inputs
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
 * Signing-result gate: whatever the native (or any) signer hands back must be the exact tx we asked to sign
 * (segwit txids exclude witness, so matching txid = inputs/outputs byte-identical), with every input signed.
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
