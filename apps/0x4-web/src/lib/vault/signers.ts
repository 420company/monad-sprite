// Signing adapter layer: wraps the "native keychain" and the "web local private key" behind one interface,
// so upper layers (transfers, flash swaps, perps, social) never need to know where the private key is.
//
// In-app: the private key lives in the Swift module; here we send requests and receive signatures.
// Web: no native layer, still uses the in-memory Keypair / private-key account — same behavior as before.
import { Transaction, VersionedTransaction, PublicKey, type Keypair } from '@solana/web3.js'
import { toAccount } from 'viem/accounts'
import { getTypesForEIP712Domain, hashDomain, hashStruct, serializeTransaction, type Account, type Hex } from 'viem'
import { hashAuthorization, recoverAddress } from 'viem/utils'
import { Vault, b64 } from './native'
import { t } from '@/lib/i18n'
import type { BtcSigner } from '@/lib/btc'

/** Solana signer. Upper layers only get these three — the private key stays out of reach */
export interface SolanaWallet {
  publicKey: PublicKey
  /** Sign in place and return the same transaction */
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

// ---------- Solana ----------

export function localSolanaWallet(kp: Keypair): SolanaWallet {
  return {
    publicKey: kp.publicKey,
    async signTransaction(tx) {
      if (tx instanceof VersionedTransaction) tx.sign([kp])
      else tx.sign(kp)
      return tx
    },
    async signMessage(message) {
      const { ed25519 } = await import('@noble/curves/ed25519')
      return ed25519.sign(message, kp.secretKey.slice(0, 32))
    },
  }
}

export function nativeSolanaWallet(address: string): SolanaWallet {
  const publicKey = new PublicKey(address)
  const sign = async (message: Uint8Array): Promise<Uint8Array> => {
    const { signature } = await Vault.signSolana({ message: b64.fromBytes(message) })
    return b64.toBytes(signature)
  }
  return {
    publicKey,
    async signTransaction(tx) {
      // The two transaction types sign different payloads: legacy signs message, versioned transactions sign message.serialize()
      const message = tx instanceof VersionedTransaction ? tx.message.serialize() : tx.serializeMessage()
      const signature = await sign(message)
      // addSignature's parameter is typed as Buffer, but at runtime any 64 bytes will do
      tx.addSignature(publicKey, signature as unknown as Parameters<Transaction['addSignature']>[1])
      return tx
    },
    signMessage: sign,
  }
}

// ---------- EVM ----------

/**
 * Native EVM account. viem's custom-account interface — createWalletClient / writeContract / signTypedData
 * all work as usual; only the signing step goes through native.
 */
export function nativeEvmAccount(address: string): Account {
  return withAuthorization(toAccount({
    address: address as Hex,

    async signMessage({ message }) {
      const bytes =
        typeof message === 'string'
          ? new TextEncoder().encode(message)
          : typeof message.raw === 'string'
            ? hexToBytes(message.raw)
            : (message.raw as Uint8Array)
      const { signature } = await Vault.signEvmMessage({ message: b64.fromBytes(bytes) })
      return signature as Hex
    },

    // EIP-712: structured data is hashed into two hashes on the web layer; native prepends 0x1901 and signs
    async signTypedData(typedData) {
      const td = typedData as unknown as { domain?: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }
      // hashDomain wants the domain field definition (EIP712Domain), not the business types;
      // passing the wrong one explodes inside viem as 't[e].map is not an object', taking down all contract-related signing.
      const domain = td.domain ?? {}
      const domainSeparator = hashDomain({
        domain,
        types: { EIP712Domain: getTypesForEIP712Domain({ domain }) },
      } as Parameters<typeof hashDomain>[0])
      const structHash = hashStruct({ data: td.message, primaryType: td.primaryType, types: td.types } as Parameters<typeof hashStruct>[0])
      const { signature } = await Vault.signEvmTypedData({ domainSeparator, structHash })
      return signature as Hex
    },

    // Transactions: serialized on the web layer, the complete unsigned tx handed to native; native verifies it's a plain transaction, computes the digest itself, then signs (GPT-6 2nd review #1)
    async signTransaction(transaction, args) {
      const serializer = args?.serializer ?? serializeTransaction
      const unsigned = await serializer(transaction)
      const { signature } = await Vault.signEvmTransaction({ tx: unsigned })
      const r = `0x${signature.slice(2, 66)}` as Hex
      const s = `0x${signature.slice(66, 130)}` as Hex
      const v = BigInt(parseInt(signature.slice(130, 132), 16))
      return serializer(transaction, { r, s, v, yParity: Number(v - 27n) })
    },
  }), async (auth) => {
    // EIP-7702 authorization (used when enabling full-auto trading): native-only method; which contract to attach to is hardcoded in native, the web layer only passes chainId and nonce (GPT-6 review #1)
    if (auth.address.toLowerCase() !== ALLOWED_7702.toLowerCase()) throw new Error(t('不支持这项授权'))
    const { signature } = await Vault.signAuthorization7702({ chainId: String(auth.chainId), nonce: String(auth.nonce) })
    const v = parseInt(signature.slice(130, 132), 16)
    const out = { r: `0x${signature.slice(2, 66)}` as Hex, s: `0x${signature.slice(66, 130)}` as Hex, yParity: v >= 27 ? v - 27 : v }
    // The web layer double-checks: the signature really authorizes "attach to this contract" — guards against native/web disagreeing
    const signer = await recoverAddress({ hash: hashAuthorization({ contractAddress: auth.address, chainId: auth.chainId, nonce: auth.nonce }), signature: { r: out.r, s: out.s, yParity: out.yParity } })
    if (signer.toLowerCase() !== address.toLowerCase()) throw new Error(t('授权签名验证未通过'))
    return out
  }, async (p) => {
    // The two full-auto delegations: native assembles from a template and signs after the system confirmation dialog (allowance and expiry stated). The generic structured-signing entry refuses delegations inside native (2nd review #1)
    const r = await Vault.signAutoTrade({ perDay: p.perDay.toString(), start: String(p.start), until: String(p.until), salt: p.salt.toString() })
    return { buyErc20: r.buyErc20 as Hex, sell: r.sell as Hex }
  })
}

/** The only allowed 7702 implementation: MetaMask Delegation Framework v1.3.0's EIP7702StatelessDeleGator (native hardcodes the same one) */
const ALLOWED_7702 = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'
/** 7702 authorization signature (viem's custom account has no such method — hung on the account object) */
export type AuthSigner = (auth: { address: Hex; chainId: number; nonce: number }) => Promise<{ r: Hex; s: Hex; yParity: number }>
/** Native signing of full-auto delegations (native accounts only; web / Android have no native layer — they use autoTradeCore's generic signing) */
export type AutoTradeSigner = (p: { perDay: bigint; start: number; until: number; salt: bigint }) => Promise<{ buyErc20: Hex; sell: Hex } | null>
function withAuthorization(acc: Account, sign: AuthSigner, autoTrade?: AutoTradeSigner): Account {
  return Object.assign(acc, { signAuthorization: sign }, autoTrade ? { signAutoTrade: autoTrade } : {})
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ---------- Gated signer (native app: addresses available while locked; verification only demanded at actual signing) ----------

/**
 * Addresses always available; signing first passes ensure (pops the verification panel if not unlocked), then goes to the current real signer.
 * real is fetched fresh each time: lock / unlock swaps the underlying signer while this shell object stays the same, so pages holding it never need to resubscribe.
 */
export function gatedSolanaWallet(address: string, real: () => SolanaWallet | null, ensure: () => Promise<void>): SolanaWallet {
  const inner = async () => {
    await ensure()
    const r = real()
    if (!r) throw new Error(t('钱包已锁定'))
    return r
  }
  return {
    publicKey: new PublicKey(address),
    async signTransaction(tx) { return (await inner()).signTransaction(tx) },
    async signMessage(message) { return (await inner()).signMessage(message) },
  }
}

export function gatedEvmAccount(address: string, real: () => Account | null, ensure: () => Promise<void>): Account {
  const inner = async () => {
    await ensure()
    const r = real()
    if (!r || r.type !== 'local') throw new Error(t('钱包已锁定'))
    return r
  }
  return withAuthorization(toAccount({
    address: address as Hex,
    async signMessage(args) { return (await inner()).signMessage(args) },
    async signTypedData(td) { return (await inner()).signTypedData(td as Parameters<Extract<Account, { type: 'local' }>['signTypedData']>[0]) },
    async signTransaction(tx, args) { return (await inner()).signTransaction(tx, args as Parameters<Extract<Account, { type: 'local' }>['signTransaction']>[1]) },
  }), async (auth) => {
    const r = (await inner()) as Account & { signAuthorization?: AuthSigner | ((a: { contractAddress: Hex; chainId: number; nonce: number }) => Promise<{ r: Hex; s: Hex; yParity?: number }>) }
    if (!r.signAuthorization) throw new Error(t('钱包不支持这项授权'))
    // The web local private-key account (viem privateKeyToAccount) names the parameter contractAddress
    const out = await (r.signAuthorization as (a: unknown) => Promise<{ r: Hex; s: Hex; yParity?: number }>)({ ...auth, contractAddress: auth.address })
    return { r: out.r, s: out.s, yParity: out.yParity ?? 0 }
  }, async (p) => {
    // Below is the web / Android local private-key account (no native layer): returns null, the caller takes the generic signing path
    const r = (await inner()) as Account & { signAutoTrade?: AutoTradeSigner }
    return r.signAutoTrade ? r.signAutoTrade(p) : null
  })
}

// ---------- Bitcoin ----------

/** Native Bitcoin signer: the transaction is built on the web layer; signing (incl. BIP143 hash computation and the "only sign my own coins" check) happens in native */
export function nativeBtcSigner(address: string): BtcSigner {
  return {
    address,
    async signTransaction(req) {
      const { tx } = await Vault.signBtc({ tx: req.tx, prevouts: req.prevouts })
      return tx
    },
  }
}

/** Gated Bitcoin signer: signing while locked pops the verification panel first, same gate as EVM / Solana */
export function gatedBtcSigner(address: string, real: () => BtcSigner | null, ensure: () => Promise<void>): BtcSigner {
  return {
    address,
    async signTransaction(req) {
      await ensure()
      const r = real()
      // Unlocked but no Bitcoin signer: derivation failed (very rare); re-unlocking derives again
      if (!r) throw new Error(t('比特币密钥不可用，请锁定后重新解锁钱包'))
      return r.signTransaction(req)
    },
  }
}
