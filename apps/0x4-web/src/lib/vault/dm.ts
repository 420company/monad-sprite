// 私信加解密。密钥由钱包私钥派生（盐 0x4-dm-v1；2026-09-25 品牌改名时换过一次，当时没有真实私信），
// App 里整个过程在原生完成，网页版沿用原来的 JS 实现。
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
  /** 本设备的加密公钥，登记到资料里别人才能发密文过来 */
  publicKey(): Promise<string>
  encrypt(text: string, peerPublicKey: string): Promise<DmPayload>
  decrypt(payload: DmPayload): Promise<string>
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function aesKey(shared: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', sha256(shared) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** 私信私钥。盐 '0x4-dm-v1' 定了就别再改：改了之后发出的私信全都解不开 */
export function dmPrivateKey(kp: Keypair): Uint8Array {
  return sha256(new Uint8Array([...new TextEncoder().encode('0x4-dm-v1'), ...kp.secretKey.slice(0, 32)]))
}

export function localDm(kp: Keypair): DmCrypto {
  return localDmFromKey(dmPrivateKey(kp))
}

/** Android：私信私钥存在本机加密存储里，冷启动时不解锁钱包也能直接用 */
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
