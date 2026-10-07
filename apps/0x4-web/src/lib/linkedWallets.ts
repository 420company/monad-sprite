// 关联其他钱包（只服务于「用 NFT 做头像」）。
//
// 场景：NFT 放在冷钱包或另一个常用钱包里，用户不想把那个钱包拿来交易，
// 但想用里面的 NFT 当头像。关联时让那个钱包签一条消息证明是本人，
// 之后验证 NFT 持有会把它一起算上。
//
// 边界：我们只记地址，不碰它的私钥，也永远不会用它发起交易。
import { api } from '@/lib/social'
import { currentWebDomain } from '@/lib/siwx'

export interface LinkedWallet {
  address: string
  chain_type: 'solana' | 'evm'
  created_at: number
}

export async function listLinkedWallets(): Promise<{ list: LinkedWallet[]; max: number }> {
  return api<{ list: LinkedWallet[]; max: number }>('/api/me/wallets')
}

/** 第一步：拿这个地址要签的消息。domain = 网页版当前域名（网页版令牌才用它；App 令牌服务器不看，消息照旧是 app.420.meme） */
export async function walletChallenge(address: string): Promise<{ message: string; issuedAt: string }> {
  return api<{ message: string; issuedAt: string; nonce: string }>(`/api/me/wallets/challenge?address=${encodeURIComponent(address)}&domain=${currentWebDomain()}`)
}

/** 第二步：交签名。验不过服务端会拒 */
export async function linkWallet(p: { address: string; chainType: 'solana' | 'evm'; signature: string; issuedAt: string }): Promise<void> {
  await api('/api/me/wallets', { method: 'POST', body: JSON.stringify(p) })
}

export async function unlinkWallet(address: string): Promise<void> {
  await api(`/api/me/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' })
}
