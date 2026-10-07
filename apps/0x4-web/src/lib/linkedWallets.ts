// Link other wallets (serves only "use an NFT as avatar").
//
// Scenario: the NFT sits in a cold wallet or another daily wallet, and the user doesn't want to trade with that wallet,
// But wants to use its NFT as an avatar. When linking, have that wallet sign a message proving ownership,
// Later NFT-holding verification will count it too.
//
// Boundary: we only record the address — never touch its private key, and never initiate transactions with it.
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

/** Step one: fetch the message this address must sign. domain = the web build's current domain (only web tokens use it; the server ignores it for app tokens, and the message stays app.420.meme) */
export async function walletChallenge(address: string): Promise<{ message: string; issuedAt: string }> {
  return api<{ message: string; issuedAt: string; nonce: string }>(`/api/me/wallets/challenge?address=${encodeURIComponent(address)}&domain=${currentWebDomain()}`)
}

/** Step two: submit the signature. The server rejects if verification fails */
export async function linkWallet(p: { address: string; chainType: 'solana' | 'evm'; signature: string; issuedAt: string }): Promise<void> {
  await api('/api/me/wallets', { method: 'POST', body: JSON.stringify(p) })
}

export async function unlinkWallet(address: string): Promise<void> {
  await api(`/api/me/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' })
}
