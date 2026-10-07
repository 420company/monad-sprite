// 证明「这个 EVM 地址归我这个账号」（2026-09-26）。
//
// 账号主键是 Solana 地址；EVM 地址以前是登录时自报的，服务器不信它做任何权限判断（管理员身份、头像发光边框、
// 门槛群、NFT 头像、充值 / 门票核对付款人）。这里用钱包的 EVM 私钥对一条固定格式的消息签 EIP-191 personal_sign，
// 服务器验过就记为已证明。
//   ① 登录签名时顺带签（loginWithWallet，同一个 nonce）
//   ② 用令牌续期、打开时钱包没解锁的：下次解锁成功后静默补签（store/social.ts 的 proveEvmIfNeeded）
//   ③ 付款前（充值 / 门票）还没证明就先补
// ★ 消息格式和服务端 server/src/auth.ts 的 evmLinkMessage 必须逐字一致（两边单测用同一个样例）。
import type { Account, Hex } from 'viem'

export const EVM_LINK_DOMAIN = '420.meme'

export function evmLinkMessage(solanaAddress: string, evmAddress: string, nonce: string): string {
  return `0x4 wallet link\ndomain: ${EVM_LINK_DOMAIN}\nsolana: ${solanaAddress}\nevm: ${evmAddress.toLowerCase()}\nnonce: ${nonce}`
}

/** 按固定格式解析关联消息；有任何一个字对不上返回 null（0x4 浏览器插件用它核对「关联的是不是我自己的两个地址」） */
export function parseEvmLinkMessage(message: string): { solana: string; evm: string; nonce: string } | null {
  if (typeof message !== 'string' || message.length > 400) return null
  const m = /^0x4 wallet link\ndomain: 420\.meme\nsolana: ([1-9A-HJ-NP-Za-km-z]{32,44})\nevm: (0x[0-9a-f]{40})\nnonce: ([0-9a-f]{16,64})$/.exec(message)
  if (!m) return null
  const [, solana, evm, nonce] = m
  return evmLinkMessage(solana, evm, nonce) === message ? { solana, evm, nonce } : null
}

/** 用 EVM 账户签关联消息。account 必须是已解锁的（带闸的外壳在锁定时会弹解锁，调用方自己判断要不要） */
export async function signEvmLink(account: Account, solanaAddress: string, nonce: string): Promise<Hex> {
  if (!account.signMessage) throw new Error('EVM account cannot sign messages')
  return account.signMessage({ message: evmLinkMessage(solanaAddress, account.address, nonce) })
}
