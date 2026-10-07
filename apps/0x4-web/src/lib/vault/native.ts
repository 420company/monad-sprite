// Web-side client of the native keyring.
//
// Inside the app, private keys live in the Swift module (native/Ox4Vault); this side only delivers "what to sign"
// and brings the signature back. The web build (app.420.meme) has no native layer — it uses the original src/lib/wallet.ts implementation.
//
// Native plugin source: ios/App/App/VaultPlugin.swift
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from '@/lib/native'

export interface VaultInfo {
  hasVault: boolean
  unlocked: boolean
  address: string
  evmAddress: string
  /** Bitcoin receiving address (bc1q…). Empty string for legacy vaults before their first unlock */
  btcAddress?: string
  /** DM key available (unlocked once, or restored from the keychain on cold start). May be true even while the wallet is locked */
  dmReady?: boolean
  /** Returned when the vault changes (created, imported, legacy upgraded); the web layer must write it back to storage */
  vault?: string
  /** Returned only when a wallet is created, for the user to copy down once */
  mnemonic?: string
}

interface VaultPlugin {
  load(o: { vault: string }): Promise<VaultInfo>
  status(): Promise<VaultInfo>
  create(o: { password: string }): Promise<VaultInfo>
  importMnemonic(o: { mnemonic: string; password: string }): Promise<VaultInfo>
  importSecret(o: { secret: string; password: string }): Promise<VaultInfo>
  unlock(o: { password: string }): Promise<VaultInfo>
  unlockWithBiometric(o: { reason: string }): Promise<VaultInfo>
  enableBiometric(o: { password: string }): Promise<{ enabled: boolean }>
  disableBiometric(): Promise<{ enabled: boolean }>
  lock(): Promise<VaultInfo>
  reset(): Promise<VaultInfo>
  signSolana(o: { message: string }): Promise<{ signature: string }>
  signEvmMessage(o: { message: string }): Promise<{ signature: string }>
  signEvmTypedData(o: { domainSeparator: string; structHash: string }): Promise<{ signature: string }>
  /** Regular tx: pass the complete unsigned transaction (hex); native checks the type and hashes it itself (there is no "sign arbitrary digest" entry anymore) */
  signEvmTransaction(o: { tx: string }): Promise<{ signature: string }>
  /** The two fully-auto-trading authorizations: native assembles from a template, pops a confirmation, then signs (params are all decimal strings) */
  signAutoTrade(o: { perDay: string; start: string; until: string; salt: string }): Promise<{ buyErc20: string; sell: string }>
  /** EIP-7702 authorization: can only delegate to the hardcoded MetaMask stateless implementation in native (chain id and nonce are decimal strings) */
  signAuthorization7702(o: { chainId: string; nonce: string }): Promise<{ signature: string }>
  agentAddress(): Promise<{ address: string }>
  signAgentTypedData(o: { domainSeparator: string; structHash: string }): Promise<{ signature: string }>
  dmPublicKey(): Promise<{ publicKey: string }>
  dmEncrypt(o: { text: string; peerPublicKey: string }): Promise<{ ciphertext: string; nonce: string; epk: string }>
  dmDecrypt(o: { ciphertext: string; nonce: string; epk: string }): Promise<{ text: string }>
  exportMnemonic(o: { password: string }): Promise<{ mnemonic: string }>
  exportSolanaSecret(o: { password: string }): Promise<{ secret: string }>
  exportEvmKey(o: { password: string }): Promise<{ secret: string }>
  /** Bitcoin: the web layer provides the unsigned tx plus each input's amount / script; native computes the BIP143 sighash and signs, returning the complete witness-carrying transaction */
  signBtc(o: { tx: string; prevouts: { amount: string; script: string }[] }): Promise<{ tx: string }>
  /** Export the Bitcoin private key (WIF) — requires password verification again */
  exportBtcWif(o: { password: string }): Promise<{ secret: string }>
  /** Keychain entries — native only allows social-token */
  secureGet(o: { key: string }): Promise<{ value?: string }>
  secureSet(o: { key: string; value: string }): Promise<void>
  secureRemove(o: { key: string }): Promise<void>
}

export const Vault = registerPlugin<VaultPlugin>('Vault')

/** Whether private keys in this runtime are held natively. False on web — the legacy JS implementation is used */
export const nativeVault = isNative && platform === 'ios'

/** Native error codes: wrong password / locked / biometrics invalidated */
export function vaultErrorCode(e: unknown): string | undefined {
  return (e as { code?: string }).code
}

export const b64 = {
  fromBytes(bytes: Uint8Array): string {
    let s = ''
    bytes.forEach((b) => (s += String.fromCharCode(b)))
    return btoa(s)
  },
  toBytes(s: string): Uint8Array {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  },
}
