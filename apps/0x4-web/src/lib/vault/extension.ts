// 网页版（420.meme/app）的签名适配层：私钥在 0x4 浏览器插件里，这里只把「要签什么」交给 window.ox4、把签名拿回来。
// 接口约定见 docs/EXTENSION_API.md（插件那边照同一份实现）。形状和原生金库的 nativeSolanaWallet / nativeEvmAccount /
// nativeBtcSigner / nativeDm 一一对应，放在 store/wallet 的带闸外壳后面，上层（转账、闪兑、合约、社交）不用改。
//
// 2026-09-29 goat：网页版不做任何创建 / 导入 / 解锁钱包的页面，钱包只连 0x4 浏览器插件。
// 插件永远不提供：导出助记词 / 私钥、创建 / 导入、eth_sign、「0x4 perp agent v2」原始消息签名。
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

// ---------- window.ox4 的类型（照 docs/EXTENSION_API.md 第 2 节） ----------

export interface Ox4Status { version: string; connected: boolean; unlocked: boolean; address: string; evmAddress: string; btcAddress: string }
export interface Ox4Accounts { address: string; evmAddress: string; btcAddress: string }
/** 网页快捷交易会话的状态（插件只给这些：开没开、到期时间。不设额度，用户自己在插件里设的单笔上限不告诉网页） */
export type Ox4PerpSession = { active: false } | { active: true; until: number }
/**
 * 网页版登录 / 连接时请插件在窗口里放一个默认勾上的「开启网页快捷交易」开关（2026-09-30 goat：登录时授权一次，之后下单不再逐笔弹窗）。
 * 不带额度（goat 2026-09-30：大户不能被额度卡住）。老版本插件 0.2.x 收到空对象按它自己的默认额度开
 */
export const PERP_SESSION_REQUEST: Record<string, never> = {}
export type Ox4Event = 'accountsChanged' | 'lock' | 'disconnect'
/** 打赏授权的状态（插件只给这些：开没开、到期时间、授权的合约和单次最多几能量） */
export type Ox4GiftSession = { active: false } | { active: true; until: number; chainId: number; contract: string; maxTip: number }

export interface Ox4Provider {
  isOx4: true
  status(): Promise<Ox4Status>
  /** perpSession：窗口里带「开启网页快捷交易」开关（老版本插件忽略这个参数） */
  connect(o?: { perpSession?: Record<string, never> }): Promise<Ox4Accounts>
  disconnect(): Promise<{ ok: true }>
  /** evmLink：同一个窗口里顺带签 EVM 关联消息（插件按自己的地址和登录 nonce 重算核对），返回 evmSignature；老版本插件不认这个参数就不返回 */
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
  /** 合约只读查询由插件代办：插件自己签名、自己请求交易所，只回结果（HTTP 状态码 + JSON），签名不出插件 */
  perpRead(o: { endpoint: PerpReadEndpoint; params?: Record<string, string> }): Promise<{ status: number; body: unknown }>
  /**
   * 合约写操作（下单 / 撤单 / 改杠杆 / 改保证金模式）由插件代办：网页只给动作和参数（lib/asterPerpWrite.ts 白名单），
   * 插件自己签名、自己请求交易所，只回每个动作的结果。没开网页快捷交易时插件弹窗确认，开了且在上限以内不弹
   */
  perpWrite(o: { actions: PerpWriteAction[] }): Promise<{ results: PerpWriteResult[] }>
  perpSessionStart(o?: Record<string, never>): Promise<Ox4PerpSession>
  perpSessionStatus(): Promise<Ox4PerpSession>
  perpSessionEnd(): Promise<Ox4PerpSession>
  dmPublicKey(): Promise<{ publicKey: string }>
  dmEncrypt(o: { text: string; peerPublicKey: string }): Promise<{ ciphertext: string; nonce: string; epk: string }>
  dmDecrypt(o: { ciphertext: string; nonce: string; epk: string }): Promise<{ text: string }>
  signBtc(o: { tx: string; prevouts: { amount: string; script: string }[] }): Promise<{ tx: string }>
  /** 打赏授权（插件 0.4.3 起）：授权一次后，这个打赏合约的送礼小票不再逐次弹窗；老版本插件没有这几个方法 */
  giftSessionStart?(o: { chainId: number; contract: string; maxTip: number }): Promise<Ox4GiftSession>
  giftSessionStatus?(): Promise<Ox4GiftSession>
  giftSessionEnd?(): Promise<Ox4GiftSession>
  signGiftTip?(o: { typedData: string }): Promise<{ signature: string }>
  on(name: Ox4Event, cb: (payload?: unknown) => void): void
  off(name: Ox4Event, cb: (payload?: unknown) => void): void
}

// ---------- 发现插件 ----------

/** 当前页面上的 0x4 插件；没装（或这个网站不在插件的白名单里）返回 null */
export function getOx4(): Ox4Provider | null {
  if (typeof window === 'undefined') return null
  const p = (window as unknown as { ox4?: Ox4Provider }).ox4
  return p && p.isOx4 === true ? p : null
}

/** 插件可能晚于页面脚本注入：等 ox4#initialized 事件，最多等 timeoutMs */
export function waitForOx4(timeoutMs = 1500): Promise<Ox4Provider | null> {
  const now = getOx4()
  if (now || typeof window === 'undefined') return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); window.removeEventListener('ox4#initialized', done); resolve(getOx4()) }
    const timer = setTimeout(done, timeoutMs)
    window.addEventListener('ox4#initialized', done)
  })
}

// ---------- 错误 ----------

/**
 * 插件抛的是 { code, message }。4001（用户拒绝 / 取消）的名字给成 UnlockCancelled，
 * lib/errors.ts 的 isUserCancel 认得，界面不弹红色提示；其它码按原文抛出（上层 errorText 会过滤原始数据）。
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

// ---------- 确认窗口排队（2026-09-29 goat 实测：一连接就弹五个窗口、合约页十几个，超过插件每站 5 个上限被自动拒） ----------
// 会弹确认窗口的请求一个一个交给插件：前一个窗口处理完（确认 / 拒绝 / 关掉）才发下一个，屏幕上同时最多一个 0x4 确认窗口。
// 用户拒绝了一个，那一刻已经排在后面的一起作废（同一批的，4001「已取消」，不再一个接一个弹）；之后新发起的操作照常。
// 不弹窗的（status、agentAddress、私信加解密、合约只读查询 perpRead）不排队。
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
/** 测试用：清空队列状态 */
export function resetOx4Queue() { tail = Promise.resolve(); refusedEpoch = 0 }

/** 签名的编码：约定里交易签名是 base58；签名串只含 base58 字母就按 base58 解，否则按 base64（插件两种都可能回） */
function decodeSig(sig: string): Uint8Array {
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(sig)) {
    const bytes = bs58.decode(sig)
    if (bytes.length === 64) return bytes
  }
  return b64.toBytes(sig)
}

/** 结构化数据整份传给插件（插件按字段显示给用户），bigint 转成十进制字符串 */
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

/** 插件里的 Solana 钱包。多了 signLogin：登录消息走插件的专用入口（弹窗显示成「登录 420.meme」） */
export type ExtensionSolanaWallet = SolanaWallet & { signLogin(message: string, evmLink?: string): Promise<{ signature: string; chain: 'solana' | 'evm'; evmSignature?: string; perpSession?: Ox4PerpSession }> }

export function extensionSolanaWallet(p: Ox4Provider, address: string): ExtensionSolanaWallet {
  const publicKey = new PublicKey(address)
  return {
    publicKey,
    async signTransaction(tx) {
      // 整笔未签名交易交给插件（它要解码、模拟余额变化给用户看），拿回签名再挂到交易上
      const raw = tx instanceof VersionedTransaction ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false })
      const { signature } = await serial(() => p.signSolanaTransaction({ tx: b64.fromBytes(raw) }))
      tx.addSignature(publicKey, decodeSig(signature) as unknown as Parameters<Transaction['addSignature']>[1])
      return tx
    },
    async signMessage(message) {
      const { signature } = await serial(() => p.signSolanaMessage({ message: b64.fromBytes(message) }))
      return decodeSig(signature)
    },
    // 网页版登录窗口里带「开启网页快捷交易」开关（默认勾上）；插件返回会话状态，合约页据此显示
    signLogin: (message, evmLink) => serial(() => p.signLogin(evmLink ? { message, evmLink } : { message, perpSession: PERP_SESSION_REQUEST })),
  }
}

// ---------- EVM ----------

/** 唯一允许挂的 7702 实现（和原生、插件写死的同一个），网页层签完再核对一遍 */
const ALLOWED_7702 = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'

export function extensionEvmAccount(p: Ox4Provider, address: string) {
  const acc = toAccount({
    address: address as Hex,
    async signMessage({ message }) {
      // 约定只收 UTF-8 原文（插件把原文显示给用户）；原始字节解不成文字就拒绝，不去盲签
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
    /** EIP-7702 授权（全自动交易）：只传链号和 nonce，挂哪个合约由插件写死；签完核对签名人 */
    async signAuthorization(auth: { address: Hex; chainId: number; nonce: number }) {
      if (auth.address.toLowerCase() !== ALLOWED_7702.toLowerCase()) throw new Error(t('不支持这项授权'))
      const { signature } = await serial(() => p.signAuthorization7702({ chainId: String(auth.chainId), nonce: String(auth.nonce) }))
      const v = parseInt(signature.slice(130, 132), 16)
      const out = { r: `0x${signature.slice(2, 66)}` as Hex, s: `0x${signature.slice(66, 130)}` as Hex, yParity: v >= 27 ? v - 27 : v }
      const signer = await recoverAddress({ hash: hashAuthorization({ contractAddress: auth.address, chainId: auth.chainId, nonce: auth.nonce }), signature: out })
      if (signer.toLowerCase() !== address.toLowerCase()) throw new Error(t('授权签名验证未通过'))
      return out
    },
    /** 全自动交易的两个委托：插件按模板组装、弹窗写明额度和到期后签 */
    async signAutoTrade(o: { perDay: bigint; start: number; until: number; salt: bigint }) {
      const r = await serial(() => p.signAutoTrade({ perDay: o.perDay.toString(), start: String(o.start), until: String(o.until), salt: o.salt.toString() }))
      return { buyErc20: r.buyErc20 as Hex, sell: r.sell as Hex }
    },
    /** 合约交易密钥：在插件里按「0x4 perp agent v2」规则派生，私钥不出插件（lib/aster.ts agentFor 认这个） */
    ox4Agent: async () => {
      const { address: agent } = await call(() => p.agentAddress())
      return {
        address: agent as Hex,
        async signTypedData(td: unknown) {
          // 2026-09-30 起只剩合约账户提现走这里（插件逐笔弹确认）；下单 / 撤单 / 改杠杆走下面的 ox4PerpWrite
          const json = typedDataJson(td)
          const { signature } = await serial(() => p.signAgentTypedData({ typedData: json }))
          return signature as Hex
        },
      }
    },
    /**
     * 合约只读查询（查账户 / 挂单 / 成交 / 杠杆分档）：交给插件代办，拿回 HTTP 状态码和交易所返回的 JSON（lib/aster.ts 的 call 认这个）。
     * 不弹窗、不排队。老版本插件没有这个方法（回 4200）：提示更新插件，不退回「网页拿签名自己请求」的老路
     */
    ox4PerpRead: async (endpoint: PerpReadEndpoint, params: Record<string, string>) => {
      try { return await call(() => p.perpRead({ endpoint, params })) } catch (e) {
        if (e instanceof Ox4Error && e.code === 4200) throw new Ox4Error(4200, t('请更新 0x4 浏览器插件后再试'))
        throw e
      }
    },
    /**
     * 合约写操作（lib/aster.ts 认这个）：一次用户操作的所有动作（改杠杆、主单、止盈止损）一起交给插件，最多一个确认窗口。
     * 可能弹窗，所以排进确认队列。老版本插件没有这个方法（「不支持的方法」4200）：提示更新插件
     */
    ox4PerpWrite: async (actions: PerpWriteAction[]) => {
      // 插件注入的 window.ox4 只带它认识的方法：老版本插件上根本没有 perpWrite
      if (typeof p.perpWrite !== 'function') throw new Ox4Error(4200, t('请更新 0x4 浏览器插件后再试'))
      return serial(() => p.perpWrite({ actions }))
    },
    /** 网页快捷交易会话：查状态、开启（插件弹窗）、关闭。老版本插件没有：状态当作没开 */
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

// ---------- 私信 ----------

/** 私信钥匙不出插件：加解密都交给它 */
export function extensionDm(p: Ox4Provider): DmCrypto {
  return {
    async publicKey() { return (await call(() => p.dmPublicKey())).publicKey },
    encrypt: (text, peerPublicKey) => call(() => p.dmEncrypt({ text, peerPublicKey })),
    async decrypt(payload) { return (await call(() => p.dmDecrypt(payload))).text },
  }
}

// ---------- 比特币 ----------

export function extensionBtcSigner(p: Ox4Provider, address: string): BtcSigner {
  return {
    address,
    async signTransaction(req) {
      const { tx } = await serial(() => p.signBtc({ tx: req.tx, prevouts: req.prevouts }))
      return tx
    },
  }
}
