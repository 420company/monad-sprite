// 钱包密钥学：助记词生成/派生、私钥导入导出、密码加密存储
// 派生路径与 Phantom / Solflare 一致：m/44'/501'/{index}'/0'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { hexToBytes, type Hex } from 'viem'
import type { CipherBlob, Vault } from './types'
import { t } from '@/lib/i18n'
import { btcAddressFromKey, btcKeyFromEvmKey, btcKeyFromMnemonic } from '@/lib/btc'
import { HDKey } from '@scure/bip32'

const PBKDF2_ITERATIONS = 250_000

/** 生成 12 个单词的助记词 */
export function newMnemonic(): string {
  return generateMnemonic(wordlist, 128)
}

export function isValidMnemonic(m: string): boolean {
  return validateMnemonic(normalizeMnemonic(m), wordlist)
}

export function normalizeMnemonic(m: string): string {
  return m.trim().toLowerCase().split(/\s+/).join(' ')
}

const WORD_SET = new Set(wordlist)

/** BIP-39 允许的助记词长度：128~256 位熵，每 32 位多 3 个词 */
export const MNEMONIC_LENGTHS = [12, 15, 18, 21, 24] as const

/** 词是否在 BIP-39 英文词表里。空串返回 true，方便「还没填」不算错 */
export function isMnemonicWord(w: string): boolean {
  return !w || WORD_SET.has(w)
}

/** 按前缀给候选词。BIP-39 词表里前 4 个字母已足够唯一 */
export function suggestMnemonicWords(prefix: string, limit = 4): string[] {
  const p = prefix.trim().toLowerCase()
  if (!p) return []
  const out: string[] = []
  for (const w of wordlist) {
    if (w.startsWith(p)) {
      out.push(w)
      if (out.length >= limit) break
    }
  }
  return out
}

/** SLIP-0010 ed25519 硬化派生（Solana 只使用硬化路径） */
function slip10Derive(seed: Uint8Array, path: number[]): Uint8Array {
  const master = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed)
  let key = master.slice(0, 32)
  let chain = master.slice(32)
  for (const index of path) {
    const hardened = (index + 0x80000000) >>> 0
    const data = new Uint8Array(1 + 32 + 4)
    data[0] = 0
    data.set(key, 1)
    new DataView(data.buffer).setUint32(33, hardened, false)
    const I = hmac(sha512, chain, data)
    key = I.slice(0, 32)
    chain = I.slice(32)
  }
  return key
}

/** 助记词 → Solana Keypair（默认第 0 个账户） */
export function keypairFromMnemonic(mnemonic: string, accountIndex = 0): Keypair {
  return keypairFromSeed(seedFromMnemonic(mnemonic), accountIndex)
}

/** 助记词 → BIP39 种子（同一组助记词派生多个钱包时只算一次，PBKDF2 2048 轮） */
export function seedFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(normalizeMnemonic(mnemonic))
}

/** BIP39 种子 → 第 accountIndex 个 Solana Keypair：m/44'/501'/{index}'/0'（Phantom 多账户同一规则） */
export function keypairFromSeed(seed: Uint8Array, accountIndex = 0): Keypair {
  return Keypair.fromSeed(slip10Derive(seed, [44, 501, accountIndex, 0]))
}

/** BIP39 种子 → 第 accountIndex 个 EVM 私钥：m/44'/60'/0'/0/{index}（MetaMask、Phantom 多账户同一规则；第 0 个 = evmKeyFromMnemonic） */
export function evmKeyFromSeed(seed: Uint8Array, accountIndex = 0): Hex {
  const priv = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${accountIndex}`).privateKey
  if (!priv) throw new Error(t('EVM 派生失败'))
  return `0x${Array.from(priv).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** 导入私钥：支持 base58 字符串（Phantom 导出格式）或 JSON 数字数组（solana-cli 格式） */
export function keypairFromSecret(input: string): Keypair {
  const s = input.trim()
  if (s.startsWith('[')) {
    const arr = JSON.parse(s) as number[]
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  const bytes = bs58.decode(s)
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes)
  if (bytes.length === 32) return Keypair.fromSeed(bytes)
  throw new Error(t('私钥长度不正确'))
}

export function exportSecretBase58(kp: Keypair): string {
  return bs58.encode(kp.secretKey)
}

// ---------- EVM 账户（与 MetaMask 一致的路径 m/44'/60'/0'/0/0） ----------

/** 助记词 → EVM 私钥（hex） */
export function evmKeyFromMnemonic(mnemonic: string): Hex {
  const hd = mnemonicToAccount(normalizeMnemonic(mnemonic)).getHdKey()
  const priv = hd.privateKey
  if (!priv) throw new Error(t('EVM 派生失败'))
  return `0x${Array.from(priv).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** EVM 私钥：64 位十六进制，可带 0x（MetaMask / OKX 等导出的格式） */
export function isEvmPrivateKey(input: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(input.trim())
}

/** 统一成 0x 开头的小写 EVM 私钥 */
export function normalizeEvmKey(input: string): Hex {
  const h = input.trim().toLowerCase()
  return (h.startsWith('0x') ? h : `0x${h}`) as Hex
}

/**
 * 判断用户粘贴的私钥是哪种：evm / solana / null（都不是）。
 * 先认 EVM：64 位十六进制几乎不可能同时是合法的 Solana 私钥（Solana 私钥 Base58 后 44 或 88 位，且不含数字 0）
 */
export function classifySecret(input: string): 'evm' | 'solana' | null {
  const s = input.trim()
  if (!s) return null
  if (isEvmPrivateKey(s)) return 'evm'
  try { keypairFromSecret(s); return 'solana' } catch { return null }
}

/**
 * 随机一把 EVM 私钥。只给测试造样本用：导入私钥时另一条链的钥匙必须用下面的固定派生，不能用它
 */
export function randomEvmKey(): Hex {
  return generatePrivateKey()
}

// ---------- 私钥导入：另一条链的钥匙固定派生 ----------
//
// 只导入一种私钥时，另一条链的钥匙由导入的这把固定算出（2026-09-29 goat：「导入一次钱包小精灵就会丢，这个不行」）。
// 以前是随机生成：0x4 账号按 Solana 地址认，同一把 EVM 私钥每导入一次就得到一个新的 Solana 地址、一个新账号，
// 换手机或重装后小精灵、好友、聊天全都对不上。现在同一把私钥在任何设备、导入多少次，都是同一组地址。
// 规则（原生 native/Ox4Vault/Sources/Ox4Vault/Derivation.swift 的 ImportDerivation 逐字节一致，
// 测试向量 native/Ox4Vault/scripts/import-fixture.json 由 make-import-fixture.py 用第三方库独立生成）：
//   EVM 私钥 → Solana：ed25519 种子 = HMAC-SHA256(key = UTF-8("0x4-wallet/solana-from-evm/v1"), data = 32 字节 EVM 私钥)
//   Solana 私钥 → EVM：k = HMAC-SHA256(key = UTF-8("0x4-wallet/evm-from-solana/v1"), data = 32 字节 Solana 种子，即 64 字节私钥的前 32 字节)；
//     k 按大端整数不在 [1, n-1]（n 为 secp256k1 的阶）时，data 末尾追加 1 字节计数 1、2、…、255 依次重算，取第一个合法的
//   比特币：私钥钱包沿用 EVM 私钥本身（btcKeyFor），随之固定
// 已有的金库不受影响：解锁照旧读存着的两把私钥，地址不变。只有新导入（以及没有 EVM 私钥的 v1 老金库补 EVM）走这套规则。
export const SOLANA_FROM_EVM_DOMAIN = '0x4-wallet/solana-from-evm/v1'
export const EVM_FROM_SOLANA_DOMAIN = '0x4-wallet/evm-from-solana/v1'
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const utf8 = (s: string) => new TextEncoder().encode(s)
const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')

/** EVM 私钥 → Solana 的 32 字节 ed25519 种子 */
export function solanaSeedFromEvmKey(evmKey: string): Uint8Array {
  if (!isEvmPrivateKey(evmKey)) throw new Error(t('EVM 私钥格式不对'))
  return hmac(sha256, utf8(SOLANA_FROM_EVM_DOMAIN), hexToBytes(normalizeEvmKey(evmKey)))
}

/** 导入 EVM 私钥时配套的 Solana 钥匙 */
export function keypairFromEvmKey(evmKey: string): Keypair {
  return Keypair.fromSeed(solanaSeedFromEvmKey(evmKey))
}

/** Solana 32 字节种子 → EVM 私钥 */
export function evmKeyFromSolanaSeed(seed: Uint8Array): Hex {
  if (seed.length !== 32) throw new Error(t('私钥长度不正确'))
  const key = utf8(EVM_FROM_SOLANA_DOMAIN)
  for (let c = 0; c < 256; c++) {
    const data = c === 0 ? seed : Uint8Array.from([...seed, c])
    const k = hmac(sha256, key, data)
    const v = BigInt(`0x${toHex(k)}`)
    if (v > 0n && v < SECP256K1_N) return `0x${toHex(k)}`
  }
  throw new Error(t('EVM 派生失败'))
}

/** 导入 Solana 私钥时配套的 EVM 私钥（用 64 字节私钥的前 32 字节种子） */
export function evmKeyFromKeypair(kp: Keypair): Hex {
  return evmKeyFromSolanaSeed(kp.secretKey.slice(0, 32))
}

export function evmAccountFromKey(key: Hex): PrivateKeyAccount {
  return privateKeyToAccount(key)
}

// ---------- 密码加密（WebCrypto：PBKDF2-SHA256 + AES-256-GCM） ----------

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBytes(plain: Uint8Array, password: string): Promise<CipherBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource)
  return { salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)), iterations: PBKDF2_ITERATIONS }
}

export async function decryptBytes(blob: CipherBlob, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, unb64(blob.salt), blob.iterations)
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.data) as BufferSource)
    return new Uint8Array(pt)
  } catch {
    throw new Error(t('密码错误'))
  }
}

export async function encryptText(text: string, password: string): Promise<CipherBlob> {
  return encryptBytes(enc.encode(text), password)
}
export async function decryptText(blob: CipherBlob, password: string): Promise<string> {
  return dec.decode(await decryptBytes(blob, password))
}

/**
 * 比特币私钥：有助记词走 BIP84（m/84'/0'/0'/0/0，和 MetaMask / Trust 同一个地址），
 * 没有助记词（私钥导入的钱包）就用 EVM 那把私钥本身。原生 Keyring.swift 规则相同。
 */
export function btcKeyFor(evmKey: string, mnemonic?: string): Uint8Array {
  return mnemonic ? btcKeyFromMnemonic(normalizeMnemonic(mnemonic)) : btcKeyFromEvmKey(evmKey)
}

/** 用密码把 Solana Keypair、EVM 私钥（和可选的助记词）打包成可持久化的金库 */
export async function buildVault(kp: Keypair, evmKey: Hex, password: string, mnemonic?: string): Promise<Vault> {
  const vault: Vault = {
    version: 2,
    publicKey: kp.publicKey.toBase58(),
    evmAddress: evmAccountFromKey(evmKey).address,
    btcAddress: btcAddressFromKey(btcKeyFor(evmKey, mnemonic)),
    secret: await encryptBytes(kp.secretKey, password),
    evmSecret: await encryptText(evmKey, password),
    createdAt: Date.now(),
  }
  if (mnemonic) vault.mnemonic = await encryptText(normalizeMnemonic(mnemonic), password)
  return vault
}

export interface Unlocked {
  keypair: Keypair
  evm: PrivateKeyAccount
  /** 比特币私钥。派生出错时为 null（不挡解锁，比特币功能提示不可用） */
  btcKey: Uint8Array | null
  /** 旧版金库升级后需要回写（含 2026-09-25 起补写比特币地址） */
  upgraded?: Vault
}

function safeBtcKey(evmKey: string, mnemonic?: string): Uint8Array | null {
  try { return btcKeyFor(evmKey, mnemonic) } catch { return null }
}

/** 解锁金库；v1 金库（只有 Solana 私钥）会自动补齐 EVM 私钥并升级到 v2 */
export async function unlockVault(vault: Vault, password: string): Promise<Unlocked> {
  const secret = await decryptBytes(vault.secret, password)
  const keypair = Keypair.fromSecretKey(secret)
  if (keypair.publicKey.toBase58() !== vault.publicKey) throw new Error(t('金库数据损坏'))

  if (vault.evmSecret) {
    // 有助记词的钱包，比特币走 BIP84，要把助记词也解开（和 EVM 私钥并行解，少等一轮 PBKDF2）
    const [evmKey, mnemonic] = await Promise.all([
      decryptText(vault.evmSecret, password),
      vault.mnemonic ? decryptText(vault.mnemonic, password) : Promise.resolve(undefined),
    ])
    const btcKey = safeBtcKey(evmKey, mnemonic)
    const btcAddress = btcKey ? btcAddressFromKey(btcKey) : undefined
    // 老金库没有比特币地址（或明文地址被改过）：补上 / 纠正后回写
    const upgraded = btcAddress && vault.btcAddress !== btcAddress ? { ...vault, btcAddress } : undefined
    return { keypair, evm: evmAccountFromKey(evmKey as Hex), btcKey, upgraded }
  }
  // 升级：有助记词就按标准路径派生，否则由 Solana 私钥固定派生（和私钥导入同一条规则，见上方「私钥导入」）
  const mnemonic = vault.mnemonic ? await decryptText(vault.mnemonic, password) : undefined
  const evmKey = mnemonic ? evmKeyFromMnemonic(mnemonic) : evmKeyFromKeypair(keypair)
  const upgraded = await buildVault(keypair, evmKey, password, mnemonic)
  upgraded.createdAt = vault.createdAt
  return { keypair, evm: evmAccountFromKey(evmKey), btcKey: safeBtcKey(evmKey, mnemonic), upgraded }
}
