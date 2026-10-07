// Wallet key management: mnemonic generation/derivation, private-key import/export, password-encrypted storage
// Derivation paths match Phantom / Solflare: m/44'/501'/{index}'/0'
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

/** Generate a 12-word mnemonic */
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

/** BIP-39 mnemonic lengths: 128–256 bits of entropy, 3 more words per 32 bits */
export const MNEMONIC_LENGTHS = [12, 15, 18, 21, 24] as const

/** Whether a word is in the BIP-39 English wordlist. Empty string returns true so "not filled yet" doesn't count as wrong */
export function isMnemonicWord(w: string): boolean {
  return !w || WORD_SET.has(w)
}

/** Suggest candidate words by prefix. In the BIP-39 wordlist the first 4 letters are already unique */
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

/** SLIP-0010 ed25519 hardened derivation (Solana only uses hardened paths) */
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

/** Mnemonic → Solana Keypair (account 0 by default) */
export function keypairFromMnemonic(mnemonic: string, accountIndex = 0): Keypair {
  return keypairFromSeed(seedFromMnemonic(mnemonic), accountIndex)
}

/** Mnemonic → BIP39 seed (computed once per mnemonic when deriving multiple wallets; PBKDF2 2048 rounds) */
export function seedFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(normalizeMnemonic(mnemonic))
}

/** BIP39 seed → Solana Keypair #accountIndex: m/44'/501'/{index}'/0' (same rule as Phantom multi-account) */
export function keypairFromSeed(seed: Uint8Array, accountIndex = 0): Keypair {
  return Keypair.fromSeed(slip10Derive(seed, [44, 501, accountIndex, 0]))
}

/** BIP39 seed → EVM private key #accountIndex: m/44'/60'/0'/0/{index} (same as MetaMask/Phantom multi-account; #0 = evmKeyFromMnemonic) */
export function evmKeyFromSeed(seed: Uint8Array, accountIndex = 0): Hex {
  const priv = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${accountIndex}`).privateKey
  if (!priv) throw new Error(t('EVM 派生失败'))
  return `0x${Array.from(priv).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Import private key: accepts a base58 string (Phantom export format) or a JSON number array (solana-cli format) */
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

// ---------- EVM account (MetaMask-compatible path m/44'/60'/0'/0/0) ----------

/** Mnemonic → EVM private key (hex) */
export function evmKeyFromMnemonic(mnemonic: string): Hex {
  const hd = mnemonicToAccount(normalizeMnemonic(mnemonic)).getHdKey()
  const priv = hd.privateKey
  if (!priv) throw new Error(t('EVM 派生失败'))
  return `0x${Array.from(priv).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** EVM private key: 64 hex chars, 0x prefix optional (MetaMask / OKX export format) */
export function isEvmPrivateKey(input: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(input.trim())
}

/** Normalize to a lowercase 0x-prefixed EVM private key */
export function normalizeEvmKey(input: string): Hex {
  const h = input.trim().toLowerCase()
  return (h.startsWith('0x') ? h : `0x${h}`) as Hex
}

/**
 * Detect which kind of private key the user pasted: evm / solana / null (neither).
 * EVM first: 64 hex chars are virtually never a valid Solana private key too (Solana keys are 44 or 88
 * base58 chars and never contain the digit 0)
 */
export function classifySecret(input: string): 'evm' | 'solana' | null {
  const s = input.trim()
  if (!s) return null
  if (isEvmPrivateKey(s)) return 'evm'
  try { keypairFromSecret(s); return 'solana' } catch { return null }
}

/**
 * A random EVM private key. For test fixtures only: when importing a key, the other chain's key must use
 * the deterministic derivation below, never this
 */
export function randomEvmKey(): Hex {
  return generatePrivateKey()
}

// ---------- Private-key import: the other chain's key is derived deterministically ----------
//
// When only one private key is imported, the other chain's key is deterministically derived from it (2026-09-29 goat: "importing once loses the wallet sprite — unacceptable").
// Previously random: 0x4 accounts are keyed by Solana address, so each import of the same EVM key produced a new Solana address — a new account,
// and after switching phones or reinstalling, sprites, friends, and chats no longer matched. Now the same key yields the same addresses on any device, however many times it's imported.
// Rules (byte-identical with native's ImportDerivation in native/Ox4Vault/Sources/Ox4Vault/Derivation.swift;
// test vectors in native/Ox4Vault/scripts/import-fixture.json generated independently by make-import-fixture.py with third-party libs):
//   EVM key → Solana: ed25519 seed = HMAC-SHA256(key = UTF-8("0x4-wallet/solana-from-evm/v1"), data = 32-byte EVM key)
//   Solana key → EVM: k = HMAC-SHA256(key = UTF-8("0x4-wallet/evm-from-solana/v1"), data = 32-byte Solana seed, i.e. the first 32 bytes of the 64-byte key);
//     if k as a big-endian integer falls outside [1, n-1] (n = secp256k1 order), append a 1-byte counter 1, 2, …, 255 to data and recompute, taking the first valid one
//   Bitcoin: key-imported wallets reuse the EVM private key itself (btcKeyFor), hence also fixed
// Existing vaults are unaffected: unlock still reads the two stored keys, addresses unchanged. Only fresh imports (and v1 vaults backfilling a missing EVM key) follow these rules.
export const SOLANA_FROM_EVM_DOMAIN = '0x4-wallet/solana-from-evm/v1'
export const EVM_FROM_SOLANA_DOMAIN = '0x4-wallet/evm-from-solana/v1'
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const utf8 = (s: string) => new TextEncoder().encode(s)
const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')

/** EVM private key → Solana's 32-byte ed25519 seed */
export function solanaSeedFromEvmKey(evmKey: string): Uint8Array {
  if (!isEvmPrivateKey(evmKey)) throw new Error(t('EVM 私钥格式不对'))
  return hmac(sha256, utf8(SOLANA_FROM_EVM_DOMAIN), hexToBytes(normalizeEvmKey(evmKey)))
}

/** The Solana key paired with an imported EVM private key */
export function keypairFromEvmKey(evmKey: string): Keypair {
  return Keypair.fromSeed(solanaSeedFromEvmKey(evmKey))
}

/** Solana 32-byte seed → EVM private key */
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

/** The EVM private key paired with an imported Solana key (uses the 64-byte key's first 32 bytes as seed) */
export function evmKeyFromKeypair(kp: Keypair): Hex {
  return evmKeyFromSolanaSeed(kp.secretKey.slice(0, 32))
}

export function evmAccountFromKey(key: Hex): PrivateKeyAccount {
  return privateKeyToAccount(key)
}

// ---------- Password encryption (WebCrypto: PBKDF2-SHA256 + AES-256-GCM) ----------

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
 * Bitcoin private key: mnemonics go BIP84 (m/84'/0'/0'/0/0, same address as MetaMask / Trust);
 * key-imported wallets (no mnemonic) reuse the EVM private key itself. Native Keyring.swift follows the same rule.
 */
export function btcKeyFor(evmKey: string, mnemonic?: string): Uint8Array {
  return mnemonic ? btcKeyFromMnemonic(normalizeMnemonic(mnemonic)) : btcKeyFromEvmKey(evmKey)
}

/** Pack the Solana Keypair, EVM private key (and optional mnemonic) into a persistable vault with the password */
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
  /** Bitcoin private key. null when derivation fails (never blocks unlock; Bitcoin features show as unavailable) */
  btcKey: Uint8Array | null
  /** Upgraded legacy vaults need a write-back (including backfilled Bitcoin addresses since 2026-09-25) */
  upgraded?: Vault
}

function safeBtcKey(evmKey: string, mnemonic?: string): Uint8Array | null {
  try { return btcKeyFor(evmKey, mnemonic) } catch { return null }
}

/** Unlock the vault; v1 vaults (Solana key only) auto-backfill the EVM key and upgrade to v2 */
export async function unlockVault(vault: Vault, password: string): Promise<Unlocked> {
  const secret = await decryptBytes(vault.secret, password)
  const keypair = Keypair.fromSecretKey(secret)
  if (keypair.publicKey.toBase58() !== vault.publicKey) throw new Error(t('金库数据损坏'))

  if (vault.evmSecret) {
    // Mnemonic wallets derive Bitcoin via BIP84, so the mnemonic must be decrypted too (in parallel with the EVM key, saving one PBKDF2 round)
    const [evmKey, mnemonic] = await Promise.all([
      decryptText(vault.evmSecret, password),
      vault.mnemonic ? decryptText(vault.mnemonic, password) : Promise.resolve(undefined),
    ])
    const btcKey = safeBtcKey(evmKey, mnemonic)
    const btcAddress = btcKey ? btcAddressFromKey(btcKey) : undefined
    // Old vaults without a Bitcoin address (or with a tampered plaintext address): backfill / correct, then write back
    const upgraded = btcAddress && vault.btcAddress !== btcAddress ? { ...vault, btcAddress } : undefined
    return { keypair, evm: evmAccountFromKey(evmKey as Hex), btcKey, upgraded }
  }
  // Upgrade: mnemonics derive via the standard path, otherwise deterministic derivation from the Solana key (same rule as private-key import, see "private-key import" above)
  const mnemonic = vault.mnemonic ? await decryptText(vault.mnemonic, password) : undefined
  const evmKey = mnemonic ? evmKeyFromMnemonic(mnemonic) : evmKeyFromKeypair(keypair)
  const upgraded = await buildVault(keypair, evmKey, password, mnemonic)
  upgraded.createdAt = vault.createdAt
  return { keypair, evm: evmAccountFromKey(evmKey), btcKey: safeBtcKey(evmKey, mnemonic), upgraded }
}
