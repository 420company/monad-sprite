// Signing adapter for the web app (420.meme/app): private keys live in the 0x4 browser extension; this layer only hands "what to sign" to window.ox4 and takes the signature back.
// Interface contract in docs/EXTENSION_API.md (the extension implements the same doc). The shape mirrors the native vault's nativeSolanaWallet / nativeEvmAccount /
// nativeBtcSigner / nativeDm one-to-one, sitting behind store/wallet's gated shell — the upper layers (transfers, swaps, perps, social) stay unchanged.
//
// 2026-09-29 goat: the web app has no create / import / unlock wallet pages at all; wallets only connect to the 0x4 browser extension.
// The extension never provides: seed-phrase / private-key export, create / import, eth_sign, or raw "0x4 perp agent v2" message signing.
import { Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { toAccount } from 'viem/accounts'
import { serializeTransaction, type Hex } from 'viem'
import { hashAuthorization, recoverAddress } from 'viem/utils'
import { b64 } from './native'
import type { SolanaWallet } from './signers'
import type { DmCrypto } from './dm'
import type { BtcSigner } from '@/lib/btc'
import { t } from '@/lib/i18n'
import type { PerpReadEndpoint } from '@/lib/asterPerpRead'
import type { PerpWriteAction, PerpWriteResult } from '@/lib/asterPerpWrite'

// ---------- window.ox4 types (per docs/EXTENSION_API.md section 2) ----------

export interface Ox4Status { version: string; connected: boolean; unlocked: boolean; address: string; evmAddress: string; btcAddress: string }
export interface Ox4Accounts { address: string; evmAddress: string; btcAddress: string }
/** Web quick-trade session status (the extension only shares: enabled or not, expiry. No limits — the per-order cap users set in the extension isn't told to the web app) */
export type Ox4PerpSession = { active: false } | { active: true; until: number }
/**
 * On web login / connect, ask the extension to include a default-on "enable web quick trading" switch in the window (2026-09-30 goat: authorize once at login, no per-order popups afterwards).
 * No limits attached (goat 2026-09-30: whales must not be throttled by limits). Old extension 0.2.x enables with its own default limits on an empty object
 */
export const PERP_SESSION_REQUEST: Record<string, never> = {}
export type Ox4Event = 'accountsChanged' | 'lock' | 'disconnect'
/** Tipping authorization status (the extension only shares: enabled or not, expiry, authorized contract and max energy per tip) */
export type Ox4GiftSession = { active: false } | { active: true; until: number; chainId: number; contract: string; maxTip: number }

export interface Ox4Provider {
  isOx4: true
  status(): Promise<Ox4Status>
  /** perpSession: the window carries the "enable web quick trading" switch (old extension versions ignore this param) */
  connect(o?: { perpSession?: Record<string, never> }): Promise<Ox4Accounts>
  disconnect(): Promise<{ ok: true }>
  /** evmLink: also sign the EVM association message in the same window (the extension re-derives and checks against its own address and the login nonce), returning evmSignature; old extension versions don't recognize this param and won't return it */
  signLogin(o: { message: string; evmLink?: string; perpSession?: Record<string, never> }): Promise<{ signature: string; chain: 'solana' | 'evm'; evmSignature?: string; perpSession?: Ox4PerpSession }>
  signSolanaTransaction(o: { tx: string }): Promise<{ signature: string }>
  signSolanaMessage(o: { message: string }): Promise<{ signature: string }>
  signEvmTransaction(o: { tx: string; chainId: number }): Promise<{ signature: string }>
  signEvmMessage(o: { message: string }): Promise<{ signature: string }>
  signEvmTypedData(o: { typedData: string }): Promise<{ signature: string }>
  signAuthorization7702(o: { chainId: string; nonce: string }): Promise<{ signature: string }>
  signAutoTrade(o: { perDay: string; start: string; until: string; salt: string }): Promise<{ buyErc20: string; sell: string }>
  agentAddress(): Promise<{ address: string }>
  signAgentTypedData(o: { typedData: string }): Promise<{ signature: string }>
  /** Perp read-only queries are delegated to the extension: the extension signs and requests the exchange itself, returning only results (HTTP status + JSON); signatures never leave the extension */
  perpRead(o: { endpoint: PerpReadEndpoint; params?: Record<string, string> }): Promise<{ status: number; body: unknown }>
  /**
   * Perp write operations (place / cancel / change leverage / change margin mode) are delegated to the extension: the web app only supplies actions and params (lib/asterPerpWrite.ts allowlist),
   * the extension signs and requests the exchange itself, returning each action's result. Without web quick trading, the extension pops a confirmation; with it enabled and within limits, no popup
   */
  perpWrite(o: { actions: PerpWriteAction[] }): Promise<{ results: PerpWriteResult[] }>
  perpSessionStart(o?: Record<string, never>): Promise<Ox4PerpSession>
  perpSessionStatus(): Promise<Ox4PerpSession>
  perpSessionEnd(): Promise<Ox4PerpSession>
  dmPublicKey(): Promise<{ publicKey: string }>
  dmEncrypt(o: { text: string; peerPublicKey: string }): Promise<{ ciphertext: string; nonce: string; epk: string }>
  dmDecrypt(o: { ciphertext: string; nonce: string; epk: string }): Promise<{ text: string }>
  signBtc(o: { tx: string; prevouts: { amount: string; script: string }[] }): Promise<{ tx: string }>
  /** Tipping authorization (extension 0.4.3+): after one authorization, gift tickets for that tipping contract no longer pop per gift; old extension versions lack these methods */
  giftSessionStart?(o: { chainId: number; contract: string; maxTip: number }): Promise<Ox4GiftSession>
  giftSessionStatus?(): Promise<Ox4GiftSession>
  giftSessionEnd?(): Promise<Ox4GiftSession>
  signGiftTip?(o: { typedData: string }): Promise<{ signature: string }>
  on(name: Ox4Event, cb: (payload?: unknown) => void): void
  off(name: Ox4Event, cb: (payload?: unknown) => void): void
}

// ---------- Extension discovery ----------

/** The 0x4 extension on the current page; null when not installed (or when this site isn't in the extension's allowlist) */
export function getOx4(): Ox4Provider | null {
  if (typeof window === 'undefined') return null
  const p = (window as unknown as { ox4?: Ox4Provider }).ox4
  return p && p.isOx4 === true ? p : null
}

/** The extension may inject later than the page scripts: wait for the ox4#initialized event, at most timeoutMs */
export function waitForOx4(timeoutMs = 1500): Promise<Ox4Provider | null> {
  const now = getOx4()
  if (now || typeof window === 'undefined') return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); window.removeEventListener('ox4#initialized', done); resolve(getOx4()) }
    const timer = setTimeout(done, timeoutMs)
    window.addEventListener('ox4#initialized', done)
  })
}

// ---------- Errors ----------

/**
 * The extension throws { code, message }. 4001 (user rejected / cancelled) is named UnlockCancelled,
 * which lib/errors.ts's isUserCancel recognizes so the UI shows no red alert; other codes are rethrown as-is (upper-layer errorText filters raw data).
 */
export class Ox4Error extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message || t('插件返回了错误'))
    this.code = code
    this.name = code === 4001 ? 'UnlockCancelled' : 'Ox4Error'
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e) {
    const x = e as { code?: unknown; message?: unknown }
    if (typeof x?.code === 'number') throw new Ox4Error(x.code, typeof x.message === 'string' ? x.message : '')
    throw e
  }
}

// ---------- Confirmation-window queue (2026-09-29 goat on-device: five windows on connect, a dozen on the perp page — past the extension's 5-per-site cap they got auto-rejected) ----------
// Requests that pop a confirmation window go to the extension one at a time: the next is sent only after the previous window is handled (confirmed / rejected / closed); at most one 0x4 confirmation window on screen at a time.
// If the user rejects one, everything already queued behind it is voided together (same batch, 4001 "cancelled", no more sequential popups); operations started afterwards behave normally.
// Non-popup calls (status, agentAddress, DM encrypt/decrypt, perp read-only queries perpRead) don't queue.
let tail: Promise<unknown> = Promise.resolve()
let refusedEpoch = 0
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const epoch = refusedEpoch
  const run = async () => {
    if (epoch !== refusedEpoch) throw new Ox4Error(4001, t('已取消'))
    try { return await call(fn) } catch (e) {
      if (e instanceof Ox4Error && e.code === 4001) refusedEpoch++
      throw e
    }
  }
  const job = tail.then(run, run)
  tail = job.catch(() => {})
  return job
}
/** Test-only: reset queue state */
export function resetOx4Queue() { tail = Promise.resolve(); refusedEpoch = 0 }

/** Signature encoding: the contract says transaction signatures are base58; if the signature string only contains base58 chars decode as base58, otherwise base64 (the extension may return either) */
function decodeSig(sig: string): Uint8Array {
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(sig)) {
    const bytes = bs58.decode(sig)
    if (bytes.length === 64) return bytes
  }
  return b64.toBytes(sig)
}

/** Structured data is passed to the extension whole (the extension displays it to the user field by field); bigints become decimal strings */
function typedDataJson(td: unknown): string {
  return JSON.stringify(td, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ---------- Solana ----------

/** The Solana wallet in the extension. Extra signLogin: login messages go through the extension's dedicated entry (the popup shows "Log in to 420.meme") */
export type ExtensionSolanaWallet = SolanaWallet & { signLogin(message: string, evmLink?: string): Promise<{ signature: string; chain: 'solana' | 'evm'; evmSignature?: string; perpSession?: Ox4PerpSession }> }

export function extensionSolanaWallet(p: Ox4Provider, address: string): ExtensionSolanaWallet {
  const publicKey = new PublicKey(address)
  return {
    publicKey,
    async signTransaction(tx) {
      // The whole unsigned transaction goes to the extension (it decodes it and simulates balance changes for the user); the signature comes back and is attached to the transaction
      const raw = tx instanceof VersionedTransaction ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false })
      const { signature } = await serial(() => p.signSolanaTransaction({ tx: b64.fromBytes(raw) }))
      tx.addSignature(publicKey, decodeSig(signature) as unknown as Parameters<Transaction['addSignature']>[1])
      return tx
    },
    async signMessage(message) {
      const { signature } = await serial(() => p.signSolanaMessage({ message: b64.fromBytes(message) }))
      return decodeSig(signature)
    },
    // The web login window carries the "enable web quick trading" switch (default on); the extension returns the session status, which the perp page displays
    signLogin: (message, evmLink) => serial(() => p.signLogin(evmLink ? { message, evmLink } : { message, perpSession: PERP_SESSION_REQUEST })),
  }
}

// ---------- EVM ----------

/** The only permitted 7702 implementation (the same one hardcoded natively and in the extension); the web layer double-checks after signing */
const ALLOWED_7702 = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'

export function extensionEvmAccount(p: Ox4Provider, address: string) {
  const acc = toAccount({
    address: address as Hex,
    async signMessage({ message }) {
      // Only UTF-8 plaintext is accepted by contract (the extension shows the text to the user); raw bytes that don't decode as text are refused — never blind-sign
      let text: string
      if (typeof message === 'string') text = message
      else {
        const bytes = typeof message.raw === 'string' ? hexToBytes(message.raw) : (message.raw as Uint8Array)
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Ox4Error(4200, t('插件只签可读的文字消息')) }
      }
      const { signature } = await serial(() => p.signEvmMessage({ message: text }))
      return signature as Hex
    },
    async signTypedData(typedData) {
      const { signature } = await serial(() => p.signEvmTypedData({ typedData: typedDataJson(typedData) }))
      return signature as Hex
    },
    async signTransaction(transaction, args) {
      const serializer = args?.serializer ?? serializeTransaction
      const unsigned = await serializer(transaction)
      const chainId = Number((transaction as { chainId?: number }).chainId || 0)
      const { signature } = await serial(() => p.signEvmTransaction({ tx: unsigned, chainId }))
      const r = `0x${signature.slice(2, 66)}` as Hex
      const s = `0x${signature.slice(66, 130)}` as Hex
      const v = BigInt(parseInt(signature.slice(130, 132), 16))
      return serializer(transaction, { r, s, v, yParity: Number(v >= 27n ? v - 27n : v) })
    },
  })
  return Object.assign(acc, {
    /** EIP-7702 authorization (fully automated trading): only chain ID and nonce are passed; which contract to attach to is hardcoded in the extension; verify the signer after signing */
    async signAuthorization(auth: { address: Hex; chainId: number; nonce: number }) {
      if (auth.address.toLowerCase() !== ALLOWED_7702.toLowerCase()) throw new Error(t('不支持这项授权'))
      const { signature } = await serial(() => p.signAuthorization7702({ chainId: String(auth.chainId), nonce: String(auth.nonce) }))
      const v = parseInt(signature.slice(130, 132), 16)
      const out = { r: `0x${signature.slice(2, 66)}` as Hex, s: `0x${signature.slice(66, 130)}` as Hex, yParity: v >= 27 ? v - 27 : v }
      const signer = await recoverAddress({ hash: hashAuthorization({ contractAddress: auth.address, chainId: auth.chainId, nonce: auth.nonce }), signature: out })
      if (signer.toLowerCase() !== address.toLowerCase()) throw new Error(t('授权签名验证未通过'))
      return out
    },
    /** The two delegations for fully automated trading: the extension assembles them from templates and signs after the popup states the limits and expiry */
    async signAutoTrade(o: { perDay: bigint; start: number; until: number; salt: bigint }) {
      const r = await serial(() => p.signAutoTrade({ perDay: o.perDay.toString(), start: String(o.start), until: String(o.until), salt: o.salt.toString() }))
      return { buyErc20: r.buyErc20 as Hex, sell: r.sell as Hex }
    },
    /** Perp trading key: derived in the extension per the "0x4 perp agent v2" rules; the private key never leaves the extension (lib/aster.ts's agentFor recognizes this) */
    ox4Agent: async () => {
      const { address: agent } = await call(() => p.agentAddress())
      return {
        address: agent as Hex,
        async signTypedData(td: unknown) {
          // Since 2026-09-30 only perp-account withdrawals go through here (the extension pops a confirmation per transaction); placing / cancelling / changing leverage goes through ox4PerpWrite below
          const json = typedDataJson(td)
          const { signature } = await serial(() => p.signAgentTypedData({ typedData: json }))
          return signature as Hex
        },
      }
    },
    /**
     * Perp read-only queries (account / open orders / fills / leverage tiers): delegated to the extension, returning the HTTP status and the exchange's JSON (lib/aster.ts's call recognizes this).
     * No popup, no queueing. Old extension versions lack this method (returns 4200): prompt to update the extension instead of falling back to the old "web fetches a signature and requests itself" path
     */
    ox4PerpRead: async (endpoint: PerpReadEndpoint, params: Record<string, string>) => {
      try { return await call(() => p.perpRead({ endpoint, params })) } catch (e) {
        if (e instanceof Ox4Error && e.code === 4200) throw new Ox4Error(4200, t('请更新 0x4 浏览器插件后再试'))
        throw e
      }
    },
    /**
     * Perp write operations (recognized by lib/aster.ts): all actions of one user operation (change leverage, main order, TP/SL) go to the extension together — at most one confirmation window.
     * May pop a window, so it enters the confirmation queue. Old extension versions lack this method ("unsupported method" 4200): prompt to update the extension
     */
    ox4PerpWrite: async (actions: PerpWriteAction[]) => {
      // The injected window.ox4 only carries methods it knows: old extension versions don't have perpWrite at all
      if (typeof p.perpWrite !== 'function') throw new Ox4Error(4200, t('请更新 0x4 浏览器插件后再试'))
      return serial(() => p.perpWrite({ actions }))
    },
    /** Web quick-trade session: query status, enable (extension popup), disable. Old extension versions lack it: treat status as disabled */
    ox4PerpSession: {
      status: async (): Promise<Ox4PerpSession> => { try { return await call(() => p.perpSessionStatus()) } catch { return { active: false } } },
      start: async (): Promise<Ox4PerpSession> => {
        if (typeof p.perpSessionStart !== 'function') throw new Ox4Error(4200, t('请更新 0x4 浏览器插件后再试'))
        return serial(() => p.perpSessionStart(PERP_SESSION_REQUEST))
      },
      end: async (): Promise<Ox4PerpSession> => typeof p.perpSessionEnd === 'function' ? call(() => p.perpSessionEnd()) : { active: false },
    },
  })
}

// ---------- DMs ----------

/** The DM key never leaves the extension: encryption and decryption are both delegated to it */
export function extensionDm(p: Ox4Provider): DmCrypto {
  return {
    async publicKey() { return (await call(() => p.dmPublicKey())).publicKey },
    encrypt: (text, peerPublicKey) => call(() => p.dmEncrypt({ text, peerPublicKey })),
    async decrypt(payload) { return (await call(() => p.dmDecrypt(payload))).text },
  }
}

// ---------- Bitcoin ----------

export function extensionBtcSigner(p: Ox4Provider, address: string): BtcSigner {
  return {
    address,
    async signTransaction(req) {
      const { tx } = await serial(() => p.signBtc({ tx: req.tx, prevouts: req.prevouts }))
      return tx
    },
  }
}
