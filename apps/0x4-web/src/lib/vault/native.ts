// 原生密钥环的网页端客户端。
//
// App 里跑的时候，私钥在 Swift 模块（native/Ox4Vault）内，这里只负责把「要签什么」
// 递过去、把签名拿回来。网页版（app.420.meme）没有原生层，走 src/lib/wallet.ts 的原有实现。
//
// 原生插件源码：ios/App/App/VaultPlugin.swift
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from '@/lib/native'

export interface VaultInfo {
  hasVault: boolean
  unlocked: boolean
  address: string
  evmAddress: string
  /** 比特币收款地址（bc1q…）。老金库第一次解锁前是空串 */
  btcAddress?: string
  /** 私信密钥可用（解锁过，或冷启动时从钥匙串装回来了）。钱包锁着也可能为 true */
  dmReady?: boolean
  /** 金库有变化（新建、导入、老金库升级）时返回，网页层要写回存储 */
  vault?: string
  /** 仅新建钱包时返回，供用户抄写一次 */
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
  /** 普通交易：给完整的未签名交易（十六进制），原生检查类型后自己算摘要（没有「签任意摘要」的入口了） */
  signEvmTransaction(o: { tx: string }): Promise<{ signature: string }>
  /** 全自动交易的两个委托：原生按模板组装、弹确认框后签（参数都是十进制字符串） */
  signAutoTrade(o: { perDay: string; start: string; until: string; salt: string }): Promise<{ buyErc20: string; sell: string }>
  /** EIP-7702 授权：只能挂到原生写死的 MetaMask 无状态实现（链号、nonce 都是十进制字符串） */
  signAuthorization7702(o: { chainId: string; nonce: string }): Promise<{ signature: string }>
  agentAddress(): Promise<{ address: string }>
  signAgentTypedData(o: { domainSeparator: string; structHash: string }): Promise<{ signature: string }>
  dmPublicKey(): Promise<{ publicKey: string }>
  dmEncrypt(o: { text: string; peerPublicKey: string }): Promise<{ ciphertext: string; nonce: string; epk: string }>
  dmDecrypt(o: { ciphertext: string; nonce: string; epk: string }): Promise<{ text: string }>
  exportMnemonic(o: { password: string }): Promise<{ mnemonic: string }>
  exportSolanaSecret(o: { password: string }): Promise<{ secret: string }>
  exportEvmKey(o: { password: string }): Promise<{ secret: string }>
  /** 比特币：网页层给未签名交易和每个输入的金额 / 脚本，原生算 BIP143 签名哈希并签，返回带见证的完整交易 */
  signBtc(o: { tx: string; prevouts: { amount: string; script: string }[] }): Promise<{ tx: string }>
  /** 导出比特币私钥（WIF），要再验一次密码 */
  exportBtcWif(o: { password: string }): Promise<{ secret: string }>
  /** 钥匙串条目，原生只允许 social-token */
  secureGet(o: { key: string }): Promise<{ value?: string }>
  secureSet(o: { key: string; value: string }): Promise<void>
  secureRemove(o: { key: string }): Promise<void>
}

export const Vault = registerPlugin<VaultPlugin>('Vault')

/** 这个运行环境的私钥是否由原生保管。网页版为 false，走旧的 JS 实现 */
export const nativeVault = isNative && platform === 'ios'

/** 原生返回的错误码：密码错 / 已锁定 / 面容失效 */
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
