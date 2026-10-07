// 网页版连外部钱包（2026-09-30 goat：MetaMask、Phantom 等也能连进来用；合约交易等是 0x4 Wallet 专属，用来推 0x4 Wallet）。
//
// · 发现：EIP-6963（浏览器里每个钱包扩展自己公告名字、图标、rdns），不抢也不读 window.ethereum。0x4 插件自己也公告，这里排除掉
//   （0x4 插件走 window.ox4 那一套，连接弹窗里单独放第一个）。
// · 签名：外部钱包只给 EIP-1193（personal_sign / eth_signTypedData_v4 / eth_sendTransaction），私钥在它自己那里，每笔都由它弹窗确认。
//   外部钱包不支持「签好交易交回来」（eth_signTransaction），所以发交易改走 eth_sendTransaction（lib/evm.ts walletClientFor）。
// · Phantom：EVM 走上面这套；它另外有 Solana（window.phantom.solana），能接就一起接上，Solana 现货也能用。
// · 外部钱包能用：登录、行情、社区、发动态、关注、现货买卖。0x4 Wallet 专属：合约交易、网页快捷交易、私信、小精灵全自动、比特币（desktop/Ox4Only.tsx）。
import { create } from 'zustand'
import { toAccount } from 'viem/accounts'
import { toHex, type Hex } from 'viem'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { SolanaWallet } from './signers'
import { t } from '@/lib/i18n'

/** 0x4 插件在 EIP-6963 里公告的 rdns（extension/src/inpage/index.ts），连接弹窗里不和第三方钱包列在一起 */
export const OX4_RDNS = 'meme.420.wallet'

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on?(event: string, cb: (...a: unknown[]) => void): unknown
  removeListener?(event: string, cb: (...a: unknown[]) => void): unknown
}
export interface WalletInfo { uuid: string; name: string; icon: string; rdns: string }
export interface WalletDetail { info: WalletInfo; provider: Eip1193Provider }

// ---------- EIP-6963 发现 ----------

/** 常见钱包的先后顺序（其余按名字排）。只影响列表顺序，0x4 Wallet 永远单独放在最上面 */
const PREFERRED = ['io.metamask', 'app.phantom', 'io.rabby', 'com.okex.wallet', 'com.coinbase.wallet', 'com.trustwallet.app', 'com.bitget.web3', 'com.binance.wallet']

/** 排序 + 去重（同一个钱包重复公告只留一个）+ 排除 0x4 插件和没名字的 */
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

/** 钱包公告的图标只收 data:image（svg / png / webp），别的地址不拿来当 <img src>（防它借图标请求外部地址）。
 *  先去掉首尾空白：Phantom 公告的图标开头带一个换行（2026-10-03 goat 发现它没 logo），原样检查会被当成不合规丢掉 */
export function safeIcon(icon: string | undefined): string | null {
  const v = typeof icon === 'string' ? icon.trim() : ''
  return /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/i.test(v) && v.length < 200_000 ? v : null
}

interface DiscoveryState { wallets: WalletDetail[] }
export const useWalletDiscovery = create<DiscoveryState>()(() => ({ wallets: [] }))

let discovering = false
/** 开始收钱包公告（只挂一次监听），并请所有钱包重新公告一次 */
export function discoverWallets(): void {
  if (typeof window === 'undefined') return
  if (!discovering) {
    discovering = true
    window.addEventListener('eip6963:announceProvider', (e: Event) => {
      const detail = (e as CustomEvent<WalletDetail>).detail
      if (!detail?.info || !detail.provider) return
      // 新公告放前面：同一个钱包重新公告（扩展重载后 provider 对象换了）时留新的那个
      useWalletDiscovery.setState((s) => ({ wallets: sortWallets([detail, ...s.wallets]) }))
    })
  }
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** 按 rdns 找已发现的钱包（刷新页面后恢复上次连的钱包用）；刚打开页面公告可能还没到，最多等 timeoutMs */
export async function findWallet(rdns: string, timeoutMs = 800): Promise<WalletDetail | null> {
  discoverWallets()
  const pick = () => useWalletDiscovery.getState().wallets.find((w) => w.info.rdns === rdns) ?? null
  if (pick()) return pick()
  await new Promise((r) => setTimeout(r, timeoutMs))
  return pick()
}

// ---------- 错误 ----------

/** 外部钱包的 4001（用户拒绝）按「已取消」处理：名字 UnlockCancelled，lib/errors isUserCancel 认得，界面不弹红字 */
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

// ---------- 链切换 ----------

export interface ChainParams { chainId: number; name: string; rpcUrl: string; nativeSymbol: string; explorer?: string }

/** 发交易前把钱包切到要用的链；钱包里没有这条链（4902）就先请它加上 */
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

// ---------- EVM 账户 ----------

/** viem 账户上挂的标记：lib/evm.ts 看到它就改用 eth_sendTransaction 让外部钱包自己发 */
export interface ExternalMark { provider: Eip1193Provider; name: string }
export const externalOf = (account: unknown): ExternalMark | null => {
  const m = (account as { ox4External?: ExternalMark } | null)?.ox4External
  return m && typeof m.provider?.request === 'function' ? m : null
}

/** 结构化数据整份交给钱包（它按字段显示给用户），bigint 转成十进制字符串 */
const typedDataJson = (td: unknown) => JSON.stringify(td, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

/** 外部钱包的 viem 账户：签文字消息、签结构化数据；发交易由 lib/evm.ts 走 eth_sendTransaction（不支持「只签不发」） */
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
      // 走不到这里：lib/evm.ts 的 walletClientFor 对外部钱包用 eth_sendTransaction
      throw new ExternalWalletError(4200, t('这个钱包不支持这项操作'))
    },
  })
  return Object.assign(acc, { ox4External: { provider: p, name } as ExternalMark })
}

// ---------- Phantom 的 Solana ----------

export interface PhantomSolana {
  isPhantom?: boolean
  connect(o?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
  disconnect?(): Promise<void>
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
  on?(event: string, cb: (...a: unknown[]) => void): unknown
}

/** 选的是 Phantom（rdns app.phantom）时，它的 Solana 接口 */
export function phantomSolana(rdns: string): PhantomSolana | null {
  if (rdns !== 'app.phantom' || typeof window === 'undefined') return null
  const s = (window as unknown as { phantom?: { solana?: PhantomSolana } }).phantom?.solana
  return s && s.isPhantom && typeof s.signTransaction === 'function' ? s : null
}

/**
 * Phantom 的 Solana 签名器，形状同 lib/vault/signers 的 SolanaWallet。
 * Phantom 签完返回的是新的交易对象，我们的发送代码（lib/rpc.ts 等）用的是原来那个，所以把签名挂回原交易上
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
