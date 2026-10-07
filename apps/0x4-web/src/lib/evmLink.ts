// Prove "this EVM address belongs to my account" (2026-09-26).
//
// The account's primary key is the Solana address; the EVM address used to be self-reported at login, and the server never trusts it for any permission decision (admin identity, avatar glow border,
// gated groups, NFT avatars, top-up / ticket payer verification). Here the wallet's EVM key signs a fixed-format message with EIP-191 personal_sign,
// and the server marks it proven after verifying.
//   ① piggyback on the login signature (loginWithWallet, same nonce)
//   ② token-renewed sessions, or opens with the wallet still locked: silently backfill on the next successful unlock (store/social.ts's proveEvmIfNeeded)
//   ③ before paying (top-up / tickets), backfill first when still unproven
// ★ The message format must be byte-identical to the server's server/src/auth.ts evmLinkMessage (both sides' unit tests use the same sample).
import type { Account, Hex } from 'viem'

export const EVM_LINK_DOMAIN = '420.meme'

export function evmLinkMessage(solanaAddress: string, evmAddress: string, nonce: string): string {
  return `0x4 wallet link\ndomain: ${EVM_LINK_DOMAIN}\nsolana: ${solanaAddress}\nevm: ${evmAddress.toLowerCase()}\nnonce: ${nonce}`
}

/** Parse a link message by the fixed format; any single char off returns null (the 0x4 browser extension uses it to verify "are these my own two addresses being linked") */
export function parseEvmLinkMessage(message: string): { solana: string; evm: string; nonce: string } | null {
  if (typeof message !== 'string' || message.length > 400) return null
  const m = /^0x4 wallet link\ndomain: 420\.meme\nsolana: ([1-9A-HJ-NP-Za-km-z]{32,44})\nevm: (0x[0-9a-f]{40})\nnonce: ([0-9a-f]{16,64})$/.exec(message)
  if (!m) return null
  const [, solana, evm, nonce] = m
  return evmLinkMessage(solana, evm, nonce) === message ? { solana, evm, nonce } : null
}

/** Sign the link message with the EVM account. account must be unlocked (the gated wrapper pops unlock when locked — callers decide whether they want that) */
export async function signEvmLink(account: Account, solanaAddress: string, nonce: string): Promise<Hex> {
  if (!account.signMessage) throw new Error('EVM account cannot sign messages')
  return account.signMessage({ message: evmLinkMessage(solanaAddress, account.address, nonce) })
}
