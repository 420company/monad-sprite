// Web connects external wallets (2026-09-30 goat: MetaMask, Phantom, etc. can all connect and be used; perps and the like stay 0x4 Wallet-exclusive to promote 0x4 Wallet).
//
// · Discovery: EIP-6963 (each wallet extension in the browser announces its own name, icon, and rdns) — never fight over or read window.ethereum. The 0x4 extension announces too, and is excluded here
//   (the 0x4 extension uses the window.ox4 flow and gets its own first slot in the connect dialog).
// · Signing: external wallets only expose EIP-1193 (personal_sign / eth_signTypedData_v4 / eth_sendTransaction); keys stay with them and every tx is confirmed in their own popup.
//   External wallets don't support "sign and hand the tx back" (eth_signTransaction), so sending goes through eth_sendTransaction instead (lib/evm.ts walletClientFor).
// · Phantom: EVM follows the flow above; it additionally exposes Solana (window.phantom.solana) — connect it too when available so Solana spot works as well.
// · External wallets can: log in, view markets, use community, post, follow, spot-trade. 0x4 Wallet exclusives: perps, web quick-trade, DMs, fully-auto sprites, Bitcoin (desktop/Ox4Only.tsx).
import { create } from 'zustand'
import { toAccount } from 'viem/accounts'
import { toHex, type Hex } from 'viem'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { SolanaWallet } from './signers'
import { t } from '@/lib/i18n'

/** The rdns the 0x4 extension announces via EIP-6963 (extension/src/inpage/index.ts); not listed alongside third-party wallets in the connect dialog */
export const OX4_RDNS = 'meme.420.wallet'

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on?(event: string, cb: (...a: unknown[]) => void): unknown
  removeListener?(event: string, cb: (...a: unknown[]) => void): unknown
}
export interface WalletInfo { uuid: string; name: string; icon: string; rdns: string }
export interface WalletDetail { info: WalletInfo; provider: Eip1193Provider }

// ---------- EIP-6963 discovery ----------

/** Ordering for well-known wallets (the rest sort by name). Only affects list order — 0x4 Wallet always sits alone at the top */
const PREFERRED = ['io.metamask', 'app.phantom', 'io.rabby', 'com.okex.wallet', 'com.coinbase.wallet', 'com.trustwallet.app', 'com.bitget.web3', 'com.binance.wallet']

/** Sort + dedupe (one entry per wallet that announces twice) + exclude the 0x4 extension and nameless ones */
export function sortWallets(list: WalletDetail[]): WalletDetail[] {
  const seen = new Set<string>()
  const out: WalletDetail[] = []
  for (const w of list) {
    const key = w?.info?.rdns || w?.info?.uuid
    if (!key || !w.info.name || !w.provider || w.info.rdns === OX4_RDNS || seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  const rank = (w: WalletDetail) => { const i = PREFERRED.indexOf(w.info.rdns); return i < 0 ? PREFERRED.length : i }
  return out.sort((a, b) => rank(a) - rank(b) || a.info.name.localeCompare(b.info.name))
}

/** Wallet-announced icons accept only data:image (svg / png / webp); other URLs are never used as <img src> (so icons can't be abused to hit external addresses).
 *  Trim whitespace first: Phantom's announced icon starts with a newline (2026-10-03 goat found it had no logo) — checking it raw would wrongly discard it as non-compliant */
export function safeIcon(icon: string | undefined): string | null {
  const v = typeof icon === 'string' ? icon.trim() : ''
  return /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/i.test(v) && v.length < 200_000 ? v : null
}

interface DiscoveryState { wallets: WalletDetail[] }
export const useWalletDiscovery = create<DiscoveryState>()(() => ({ wallets: [] }))

let discovering = false
/** Start collecting wallet announcements (listener attached once) and ask all wallets to re-announce */
export function discoverWallets(): void {
  if (typeof window === 'undefined') return
  if (!discovering) {
    discovering = true
    window.addEventListener('eip6963:announceProvider', (e: Event) => {
      const detail = (e as CustomEvent<WalletDetail>).detail
      if (!detail?.info || !detail.provider) return
      // New announcements go first: when the same wallet re-announces (provider object replaced after an extension reload), keep the new one
      useWalletDiscovery.setState((s) => ({ wallets: sortWallets([detail, ...s.wallets]) }))
    })
  }
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** Find a discovered wallet by rdns (used to restore the last-connected wallet after refresh); announcements may not have arrived right after page open — wait up to timeoutMs */
export async function findWallet(rdns: string, timeoutMs = 800): Promise<WalletDetail | null> {
  discoverWallets()
  const pick = () => useWalletDiscovery.getState().wallets.find((w) => w.info.rdns === rdns) ?? null
  if (pick()) return pick()
  await new Promise((r) => setTimeout(r, timeoutMs))
  return pick()
}

// ---------- Errors ----------

/** An external wallet's 4001 (user rejected) is treated as "cancelled": named UnlockCancelled, recognized by lib/errors isUserCancel, no red error toast */
export class ExternalWalletError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message || t('钱包返回了错误'))
    this.code = code
    this.name = code === 4001 ? 'UnlockCancelled' : 'ExternalWalletError'
  }
}
export async function walletRequest<T>(p: Eip1193Provider, method: string, params?: unknown): Promise<T> {
  try { return await p.request(params === undefined ? { method } : { method, params }) as T } catch (e) {
    const x = e as { code?: unknown; message?: unknown }
    if (typeof x?.code === 'number') throw new ExternalWalletError(x.code, typeof x.message === 'string' ? x.message : '')
    throw e
  }
}

// ---------- Chain switching ----------

export interface ChainParams { chainId: number; name: string; rpcUrl: string; nativeSymbol: string; explorer?: string }

/** Switch the wallet to the needed chain before sending; when the wallet lacks the chain (4902), ask it to add the chain first */
export async function ensureChain(p: Eip1193Provider, c: ChainParams): Promise<void> {
  const want = toHex(c.chainId)
  const cur = await walletRequest<string>(p, 'eth_chainId').catch(() => '')
  if (typeof cur === 'string' && cur.toLowerCase() === want.toLowerCase()) return
  try { await walletRequest(p, 'wallet_switchEthereumChain', [{ chainId: want }]) } catch (e) {
    if (!(e instanceof ExternalWalletError) || (e.code !== 4902 && e.code !== -32603)) throw e
    await walletRequest(p, 'wallet_addEthereumChain', [{
      chainId: want, chainName: c.name, rpcUrls: [c.rpcUrl], nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
      ...(c.explorer ? { blockExplorerUrls: [c.explorer] } : {}),
    }])
  }
  const now = await walletRequest<string>(p, 'eth_chainId').catch(() => '')
  if (typeof now !== 'string' || now.toLowerCase() !== want.toLowerCase()) throw new ExternalWalletError(4901, t('请在钱包里切换到 {chain}', { chain: c.name }))
}

// ---------- EVM account ----------

/** Marker hung on the viem account: lib/evm.ts sees it and switches to eth_sendTransaction so the external wallet sends itself */
export interface ExternalMark { provider: Eip1193Provider; name: string }
export const externalOf = (account: unknown): ExternalMark | null => {
  const m = (account as { ox4External?: ExternalMark } | null)?.ox4External
  return m && typeof m.provider?.request === 'function' ? m : null
}

/** Structured data is handed to the wallet whole (it renders it field-by-field to the user); bigints become decimal strings */
const typedDataJson = (td: unknown) => JSON.stringify(td, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

/** The external wallet's viem account: signs text messages and structured data; sending goes through lib/evm.ts via eth_sendTransaction ("sign-only" unsupported) */
export function eip1193Account(p: Eip1193Provider, address: string, name: string) {
  const acc = toAccount({
    address: address as Hex,
    async signMessage({ message }) {
      const data = typeof message === 'string' ? toHex(new TextEncoder().encode(message)) : typeof message.raw === 'string' ? message.raw : toHex(message.raw)
      return walletRequest<Hex>(p, 'personal_sign', [data, address])
    },
    async signTypedData(typedData) {
      return walletRequest<Hex>(p, 'eth_signTypedData_v4', [address, typedDataJson(typedData)])
    },
    async signTransaction() {
      // Unreachable: lib/evm.ts's walletClientFor uses eth_sendTransaction for external wallets
      throw new ExternalWalletError(4200, t('这个钱包不支持这项操作'))
    },
  })
  return Object.assign(acc, { ox4External: { provider: p, name } as ExternalMark })
}

// ---------- Phantom's Solana ----------

export interface PhantomSolana {
  isPhantom?: boolean
  connect(o?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
  disconnect?(): Promise<void>
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
  on?(event: string, cb: (...a: unknown[]) => void): unknown
}

/** Its Solana interface, when Phantom (rdns app.phantom) is selected */
export function phantomSolana(rdns: string): PhantomSolana | null {
  if (rdns !== 'app.phantom' || typeof window === 'undefined') return null
  const s = (window as unknown as { phantom?: { solana?: PhantomSolana } }).phantom?.solana
  return s && s.isPhantom && typeof s.signTransaction === 'function' ? s : null
}

/**
 * Phantom's Solana signer, shaped like lib/vault/signers' SolanaWallet.
 * Phantom returns a new transaction object after signing, but our send code (lib/rpc.ts etc.) uses the original — so the signature is attached back onto the original transaction
 */
export function phantomSolanaWallet(s: PhantomSolana, address: string): SolanaWallet {
  const publicKey = new PublicKey(address)
  return {
    publicKey,
    async signTransaction(tx) {
      const signed = await callPhantom(() => s.signTransaction(tx))
      let sig: Uint8Array | null = null
      if (signed instanceof VersionedTransaction) {
        const i = signed.message.staticAccountKeys.findIndex((k) => k.equals(publicKey))
        sig = i >= 0 ? signed.signatures[i] : null
      } else {
        sig = (signed as Transaction).signatures.find((x) => x.publicKey.equals(publicKey))?.signature ?? null
      }
      if (!sig) throw new ExternalWalletError(5000, t('钱包没有返回签名'))
      tx.addSignature(publicKey, sig as unknown as Parameters<Transaction['addSignature']>[1])
      return tx
    },
    async signMessage(message) {
      return (await callPhantom(() => s.signMessage(message, 'utf8'))).signature
    },
  }
}
async function callPhantom<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e) {
    const x = e as { code?: unknown; message?: unknown }
    if (typeof x?.code === 'number') throw new ExternalWalletError(x.code, typeof x.message === 'string' ? x.message : '')
    throw e
  }
}
