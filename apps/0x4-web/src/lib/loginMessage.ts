// 0x4 login messages (the server's server/src/siwx.ts loginMessage / webLoginMessage issues the challenge, the wallet signs). The format must match character-for-character on both sides.
// Since 2026-09-30 it's the standard format with a domain; templates in src/lib/siwx.ts:
//   · Mobile app: Solana address + SIWS (Sign In With Solana), domain = app.420.meme. The app signs the server-issued message as-is; it's not assembled here.
//   · Desktop web (goat's call: log in with the 0x address): the extension's EVM key signs SIWE (EIP-4361), domain = the web app's domain, Chain ID 56
//     (issued by /api/auth/nonce?address=0x…&surface=web). The server marks the token web or not based on the matched template; web tokens can't approve QR logins on desktop / the admin console.
// The 0x4 browser extension only signs the web template (parseWebLoginMessage recognizes "this is genuinely a 0x4 web login message"; the extension then verifies the address is its own EVM address
// and that the domain is the requesting site), and refuses all app templates: otherwise a same-origin malicious script could get the extension to sign an app template and exchange it for an app token that approves admin-console QR logins.
// Third-party wallets like Phantom and MetaMask recognize this format and warn or refuse when phishing sites use these messages to trick users into signing.
import { parseSiweMessage } from 'viem/siwe'
import { APP_DOMAIN, WEB_DOMAIN, LOGIN_STATEMENT_APP, isOx4Domain, siwxHeaders, siwxMessage, stripInvisible, webLoginMessageFor } from './siwx'

export function loginMessage(address: string, nonce: string, issuedAt: string): string {
  return siwxMessage({ domain: APP_DOMAIN, chain: 'solana', address, statement: LOGIN_STATEMENT_APP, nonce, issuedAt })
}

/** Web login (0x address + SIWE); evmAddress is case-insensitive (the message uses EIP-55 checksums). domain defaults to the web app's own domain; the web app on 420.meme passes 420.meme */
export function webLoginMessage(evmAddress: string, nonce: string, issuedAt: string, domain: string = WEB_DOMAIN): string {
  return webLoginMessageFor(domain, evmAddress, nonce, issuedAt)
}

/** The two login templates before 2026-09-30 (the server no longer accepts them; kept for recognition and refusal; the web one was still Solana-signed back then) */
export function legacyLoginMessage(address: string, nonce: string, issuedAt: string): string {
  return `0x4 登录\n\n地址: ${address}\nNonce: ${nonce}\n时间: ${issuedAt}\n\n签名不会发起任何链上交易，也不会花费 Gas。`
}
export function legacyWebLoginMessage(address: string, nonce: string, issuedAt: string): string {
  return `0x4 网页版登录\n\n地址: ${address}\nNonce: ${nonce}\n时间: ${issuedAt}\n\n签名不会发起任何链上交易，也不会花费 Gas。`
}

/**
 * Parse per the server's web template (0x-address SIWE); returns null on any character mismatch (including app templates, old templates, extra fields).
 * address is the message's EIP-55 spelling; domain is returned as-is: the extension must verify it's the requesting site and the address is its own (extension/src/background/ox4.ts signLogin)
 */
export function parseWebLoginMessage(message: string): { address: string; nonce: string; issuedAt: string; domain: string } | null {
  if (typeof message !== 'string' || message.length > 800) return null
  let p: ReturnType<typeof parseSiweMessage>
  try { p = parseSiweMessage(message) } catch { return null }
  if (!p.domain || !p.address || !p.nonce || !(p.issuedAt instanceof Date) || Number.isNaN(p.issuedAt.getTime())) return null
  if (!/^[0-9a-f]{16,64}$/.test(p.nonce) || !/^[a-z0-9.-]+(?::\d+)?$/.test(p.domain)) return null
  const issuedAt = p.issuedAt.toISOString()
  let rebuilt: string
  try { rebuilt = webLoginMessageFor(p.domain, p.address, p.nonce, issuedAt) } catch { return null }
  return rebuilt === message ? { address: p.address, nonce: p.nonce, issuedAt, domain: p.domain } : null
}

/**
 * Looks like a 0x4 login / link-wallet / EVM-link message (lib/evmLink): anything touching it counts — over-block rather than under-block.
 * The 0x4 browser extension's generic signing entry (personal_sign for other sites, the web's signEvmMessage / signSolanaMessage)
 * refuses all such messages (2026-09-29 security review: phishing sites tricking signatures of these messages via generic signing could claim victims' addresses).
 *   · Old templates: 0x4 login / web-login Chinese variants, "0x4 wallet link"
 *   · New templates (2026-09-30): SIWE / SIWS whose first-line domain is one of 0x4's own domains (420.meme and subdomains, the web app's domain).
 *     Other sites' own SIWE (domains that aren't ours) aren't blocked here — the extension's domain comparison handles those (policy.ts refuseSiwxMismatch).
 * Zero-width chars and BOMs are stripped first. "0x4" and the Chinese word for "login" separated by a few same-line words (web version, wallet…) also count.
 */
export function looksLikeOx4AuthMessage(message: string): boolean {
  if (typeof message !== 'string') return false
  const s = stripInvisible(message)   // Zero-width space / zero-width non-joiner / zero-width joiner, word joiner, BOM, soft hyphen
  if (/0x4[^\n]{0,20}?登[录錄]/i.test(s) || /[网網]\s*[页頁]\s*版\s*登[录錄]/.test(s) || /0x4\s*wallet\s*link/i.test(s)) return true
  return siwxHeaders(s).some((h) => isOx4Domain(h.domain))
}
