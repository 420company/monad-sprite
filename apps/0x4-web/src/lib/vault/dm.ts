// DM encryption/decryption. Keys are derived from the wallet private key (salt 0x4-dm-v1; changed once at the 2026-09-25 brand rename, when there were no real DMs yet),
// the app does the whole flow natively; the web version keeps the original JS implementation.
import { x25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Keypair } from '@solana/web3.js'
import { Vault } from './native'

export interface DmPayload {
  ciphertext: string
  nonce: string
  epk: string
}

export interface DmCrypto {
  /** This device's encryption public key; it must be registered in the profile before others can send ciphertext */
  publicKey(): Promise<string>
  encrypt(text: string, peerPublicKey: string): Promise<DmPayload>
  decrypt(payload: DmPayload): Promise<string>
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function aesKey(shared: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', sha256(shared) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** The DM private key. Once set, never change the '0x4-dm-v1' salt again: DMs sent after a change can't be decrypted */
export function dmPrivateKey(kp: Keypair): Uint8Array {
  return sha256(new Uint8Array([...new TextEncoder().encode('0x4-dm-v1'), ...kp.secretKey.slice(0, 32)]))
}

export function localDm(kp: Keypair): DmCrypto {
  return localDmFromKey(dmPrivateKey(kp))
}

/** Android: the DM private key lives in on-device encrypted storage, usable on cold start without unlocking the wallet */
export function localDmFromKey(priv: Uint8Array): DmCrypto {
  return {
    async publicKey() { return b64(x25519.getPublicKey(priv)) },
    async encrypt(text, peerPublicKey) {
      const eph = x25519.utils.randomSecretKey()
      const key = await aesKey(x25519.getSharedSecret(eph, unb64(peerPublicKey)))
      const nonce = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, new TextEncoder().encode(text))
      return { ciphertext: b64(new Uint8Array(ct)), nonce: b64(nonce), epk: b64(x25519.getPublicKey(eph)) }
    },
    async decrypt(payload) {
      const key = await aesKey(x25519.getSharedSecret(priv, unb64(payload.epk)))
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.nonce) as BufferSource }, key, unb64(payload.ciphertext) as BufferSource)
      return new TextDecoder().decode(pt)
    },
  }
}

export const dmKeyToB64 = b64
export const dmKeyFromB64 = unb64

export function nativeDm(): DmCrypto {
  return {
    async publicKey() { return (await Vault.dmPublicKey()).publicKey },
    async encrypt(text, peerPublicKey) { return Vault.dmEncrypt({ text, peerPublicKey }) },
    async decrypt(payload) { return (await Vault.dmDecrypt(payload)).text },
  }
}
