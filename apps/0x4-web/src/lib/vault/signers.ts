// 签名适配层：把「原生密钥环」和「网页版本地私钥」包装成同一套接口，
// 上层（转账、闪兑、合约、社交）不需要知道私钥在哪。
//
// App 里：私钥在 Swift 模块内，这里发请求收签名。
// 网页版：没有原生层，仍用内存里的 Keypair / 私钥账户，行为和以前一致。
import { Transaction, VersionedTransaction, PublicKey, type Keypair } from '@solana/web3.js'
import { toAccount } from 'viem/accounts'
import { getTypesForEIP712Domain, hashDomain, hashStruct, serializeTransaction, type Account, type Hex } from 'viem'
import { hashAuthorization, recoverAddress } from 'viem/utils'
import { Vault, b64 } from './native'
import { t } from '@/lib/i18n'
import type { BtcSigner } from '@/lib/btc'

/** Solana 签名器。上层只用得到这三样，拿不到私钥 */
export interface SolanaWallet {
  publicKey: PublicKey
  /** 就地签名并返回同一笔交易 */
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
      // 两种交易的待签内容不同：旧版签 message，版本化交易签 message.serialize()
      const message = tx instanceof VersionedTransaction ? tx.message.serialize() : tx.serializeMessage()
      const signature = await sign(message)
      // addSignature 的参数类型写的是 Buffer，运行时只要 64 字节就行
      tx.addSignature(publicKey, signature as unknown as Parameters<Transaction['addSignature']>[1])
      return tx
    },
    signMessage: sign,
  }
}

// ---------- EVM ----------

/**
 * 原生 EVM 账户。viem 的自定义账户接口，createWalletClient / writeContract / signTypedData
 * 全都照常用，区别只是签名那一步走原生。
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

    // EIP-712：结构化数据在网页层算成两个哈希，原生拼 0x1901 后签
    async signTypedData(typedData) {
      const td = typedData as unknown as { domain?: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }
      // hashDomain 要的是域字段定义（EIP712Domain），不是业务类型；
      // 传错会在 viem 内部炸成 't[e].map is not an object'，合约相关签名全挂。
      const domain = td.domain ?? {}
      const domainSeparator = hashDomain({
        domain,
        types: { EIP712Domain: getTypesForEIP712Domain({ domain }) },
      } as Parameters<typeof hashDomain>[0])
      const structHash = hashStruct({ data: td.message, primaryType: td.primaryType, types: td.types } as Parameters<typeof hashStruct>[0])
      const { signature } = await Vault.signEvmTypedData({ domainSeparator, structHash })
      return signature as Hex
    },

    // 交易：网页层序列化，把完整的未签名交易交给原生；原生检查是普通交易、自己算摘要再签（GPT-6 第二轮审查 #1）
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
    // EIP-7702 授权（全自动交易开启时用）：原生专用方法，挂到哪个合约由原生写死，网页层只传链号和 nonce（GPT-6 审查 #1）
    if (auth.address.toLowerCase() !== ALLOWED_7702.toLowerCase()) throw new Error(t('不支持这项授权'))
    const { signature } = await Vault.signAuthorization7702({ chainId: String(auth.chainId), nonce: String(auth.nonce) })
    const v = parseInt(signature.slice(130, 132), 16)
    const out = { r: `0x${signature.slice(2, 66)}` as Hex, s: `0x${signature.slice(66, 130)}` as Hex, yParity: v >= 27 ? v - 27 : v }
    // 网页层再核对一遍：签名确实是对「挂到这个合约」的授权签的，防止原生和网页两边理解不一致
    const signer = await recoverAddress({ hash: hashAuthorization({ contractAddress: auth.address, chainId: auth.chainId, nonce: auth.nonce }), signature: { r: out.r, s: out.s, yParity: out.yParity } })
    if (signer.toLowerCase() !== address.toLowerCase()) throw new Error(t('授权签名验证未通过'))
    return out
  }, async (p) => {
    // 全自动的两个委托：原生按模板组装、弹系统确认框（写明额度和到期）后签。通用的结构化签名入口在原生里拒签委托（第二轮审查 #1）
    const r = await Vault.signAutoTrade({ perDay: p.perDay.toString(), start: String(p.start), until: String(p.until), salt: p.salt.toString() })
    return { buyErc20: r.buyErc20 as Hex, sell: r.sell as Hex }
  })
}

/** 唯一允许挂的 7702 实现：MetaMask Delegation Framework v1.3.0 的 EIP7702StatelessDeleGator（原生也写死同一个） */
const ALLOWED_7702 = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'
/** 7702 授权签名（viem 的自定义账户没有这个方法，挂在账户对象上） */
export type AuthSigner = (auth: { address: Hex; chainId: number; nonce: number }) => Promise<{ r: Hex; s: Hex; yParity: number }>
/** 全自动委托的原生签名（只有原生账户有；网页版 / Android 没有原生层，走 autoTradeCore 的通用签名） */
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

// ---------- 带闸的签名器（原生 App：钱包锁着也能拿地址，真签名时才要求验证） ----------

/**
 * 地址随时可用，签名前先过 ensure（没解锁就弹验证面板），再交给当前真正的签名器。
 * real 每次现取：解锁 / 锁定会换掉底下的签名器，这个外壳对象本身不变，页面拿着它不用重新订阅。
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
    // 网页版的本地私钥账户（viem privateKeyToAccount）参数名是 contractAddress
    const out = await (r.signAuthorization as (a: unknown) => Promise<{ r: Hex; s: Hex; yParity?: number }>)({ ...auth, contractAddress: auth.address })
    return { r: out.r, s: out.s, yParity: out.yParity ?? 0 }
  }, async (p) => {
    // 底下是网页版 / Android 的本地私钥账户（没有原生层）：返回 null，由调用方走通用签名
    const r = (await inner()) as Account & { signAutoTrade?: AutoTradeSigner }
    return r.signAutoTrade ? r.signAutoTrade(p) : null
  })
}

// ---------- 比特币 ----------

/** 原生比特币签名器：交易在网页层构造，签名（含 BIP143 哈希计算与「只签自己的币」检查）在原生 */
export function nativeBtcSigner(address: string): BtcSigner {
  return {
    address,
    async signTransaction(req) {
      const { tx } = await Vault.signBtc({ tx: req.tx, prevouts: req.prevouts })
      return tx
    },
  }
}

/** 带闸的比特币签名器：锁着时签名先弹验证面板，和 EVM / Solana 同一个闸 */
export function gatedBtcSigner(address: string, real: () => BtcSigner | null, ensure: () => Promise<void>): BtcSigner {
  return {
    address,
    async signTransaction(req) {
      await ensure()
      const r = real()
      // 解锁了却没有比特币签名器：派生出错（极少见），重新解锁会再算一次
      if (!r) throw new Error(t('比特币密钥不可用，请锁定后重新解锁钱包'))
      return r.signTransaction(req)
    },
  }
}
