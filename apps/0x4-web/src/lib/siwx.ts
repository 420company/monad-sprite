// Standard domain-bound signing messages (2026-09-30 anti-phishing overhaul): EVM = EIP-4361 "Sign-In with Ethereum", Solana = SIWS "Sign In With Solana".
// The server (server/src/siwx.ts) issues the challenges; this is the same template (byte-identical — both sides' tests use the same sample text) plus the parsing / matching the 0x4 browser extension needs:
//   · webLoginMessageFor / parseLoginMessage: SIWE for web 0x login, SIWS for app login (the extension's signLogin only signs the web one; parsing lives in loginMessage.ts)
//   · siwxHeaders / siwxMatchesOrigin: whenever any site asks the extension to sign SIWE / SIWS text, the message's domain must be the requesting site itself (same as MetaMask and Phantom)
//   · isOx4Domain: message domain is 0x4's own → the generic signing entry refuses outright (phishing sites tricking signatures with 0x4's messages)
// ★ statement must be ASCII-only (MetaMask's SIWE parser strictly follows the EIP-4361 ABNF — Chinese in it means it's not recognized as SIWE and the domain is never matched).
import { getAddress } from 'viem'
import { createSiweMessage } from 'viem/siwe'

/** Mobile app login, and wallets linked in the app (= the hostname of the WalletConnect metadata url in the app, src/lib/walletConnect.ts) */
export const APP_DOMAIN = 'app.420.meme'
/** The desktop web's original domain (used for issuing challenges anywhere not in WEB_DOMAINS, e.g. local dev and preview URLs). Matches server/src/siwx.ts */
export const WEB_DOMAIN = '0x4-site.vercel.app'
/**
 * Every domain the web client may live on (2026-09-30 goat: 420.meme becomes the web home later; switch steps in docs/DOMAIN_SWITCH.md).
 * Matches server/src/siwx.ts WEB_DOMAINS; extension-trusted origins (extension/src/shared/protocol.ts OX4_ORIGINS) are added separately as the switch progresses
 */
export const WEB_DOMAINS: readonly string[] = [WEB_DOMAIN, '420.meme']
/** The domain the web client is currently on: use it when listed (sent to the server when fetching the challenge — the login message's domain is it), otherwise the original domain */
export function currentWebDomain(): string {
  const h = typeof location !== 'undefined' ? location.host : ''
  return WEB_DOMAINS.includes(h) ? h : WEB_DOMAIN
}
/** Chain id written by web login (0x address + SIWE, 2026-09-30): BSC mainnet */
export const WEB_LOGIN_CHAIN_ID = 56
export const SIWX_TTL_MS = 5 * 60_000

export type SiwxChain = 'solana' | 'evm'

export const LOGIN_STATEMENT_APP = 'Sign in to the 0x4 app with this wallet. This will not send a transaction or cost any gas fees.'
export const LOGIN_STATEMENT_WEB = 'Sign in to the 0x4 web app with this wallet. This will not send a transaction or spend any funds.'
export const walletLinkStatement = (account: string) =>
  `Link this wallet to 0x4 account ${account}. This only proves you own this wallet. It will not send a transaction or cost any gas fees.`

/** Build the message per the EIP-4361 / SIWS text format (byte-identical to server/src/siwx.ts siwxMessage) */
export function siwxMessage(o: { domain: string; chain: SiwxChain; address: string; statement: string; nonce: string; issuedAt: string }): string {
  const t = Date.parse(o.issuedAt)
  const exp = Number.isFinite(t) ? new Date(t + SIWX_TTL_MS).toISOString() : ''
  return [
    `${o.domain} wants you to sign in with your ${o.chain === 'evm' ? 'Ethereum' : 'Solana'} account:`,
    o.address,
    '',
    o.statement,
    '',
    `URI: https://${o.domain}`,
    'Version: 1',
    `Chain ID: ${o.chain === 'evm' ? '1' : 'mainnet'}`,
    `Nonce: ${o.nonce}`,
    `Issued At: ${o.issuedAt}`,
    `Expiration Time: ${exp}`,
  ].join('\n')
}

/**
 * Desktop web login (2026-09-30 goat's call: web logs in with the 0x address): EIP-4361 (SIWE) signed by the 0x4 extension with the EVM key,
 * byte-identical to the server's server/src/siwx.ts webLoginMessage (domain = the web client's current domain, one of WEB_DOMAINS). The extension also rebuilds and compares using the domain written in the message.
 */
export function webLoginMessageFor(domain: string, evmAddress: string, nonce: string, issuedAt: string): string {
  const t = Date.parse(issuedAt)
  return createSiweMessage({
    domain, address: getAddress(evmAddress.toLowerCase()), statement: LOGIN_STATEMENT_WEB, uri: `https://${domain}`,
    version: '1', chainId: WEB_LOGIN_CHAIN_ID, nonce, issuedAt: new Date(t), expirationTime: new Date(t + SIWX_TTL_MS),
  })
}

/** Message for linking other wallets (challenged by the server at /api/me/wallets/challenge; here only for tests and extension interception) */
export function walletLinkMessage(account: string, address: string, nonce: string, issuedAt: string, web = false, webDomain: string = WEB_DOMAIN): string {
  const evm = address.startsWith('0x')
  return siwxMessage({
    domain: web ? webDomain : APP_DOMAIN, chain: evm ? 'evm' : 'solana', address: evm ? getAddress(address.toLowerCase()) : address,
    statement: walletLinkStatement(account), nonce, issuedAt,
  })
}

// ---------- Parsing & matching (for the 0x4 browser extension) ----------

/** Strip zero-width chars, BOM, and soft hyphens before judging (phishing sites may sandwich them into domains) */
export const stripInvisible = (s: string) => s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')

/**
 * Find every "<domain> wants you to sign in with your <X> account:" line in the message (the first line of SIWE / SIWS).
 * The spec wants it on line one; here every line is scanned with whitespace and case relaxed (better to over-match — padding lines by a phishing site won't escape it).
 * scheme = the "https://" style prefix the spec allows before the domain (undefined when absent)
 */
export function siwxHeaders(message: string): { scheme?: string; domain: string }[] {
  if (typeof message !== 'string') return []
  const out: { scheme?: string; domain: string }[] = []
  for (const line of stripInvisible(message).split(/\r?\n/)) {
    const m = /^\s*(?:([A-Za-z][A-Za-z0-9+.-]*):\/\/)?(\S+?)\s+wants\s+you\s+to\s+sign\s+in\s+with\s+your\s+\S+\s+account:?\s*$/i.exec(line)
    if (m) out.push({ scheme: m[1], domain: m[2] })
  }
  return out
}

/**
 * Whether the SIWE / SIWS domain matches the requesting site (origin — the browser's sender.origin).
 * Rules follow MetaMask (@metamask/controller-utils isValidSIWEOrigin): hostnames must match (case-insensitive); a port in the domain must match the origin
 * (the default port counts too); a username must match as well. A scheme written before the domain must also match. Anything unparsable counts as a mismatch.
 */
export function siwxMatchesOrigin(h: { scheme?: string; domain: string }, origin: string): boolean {
  try {
    const o = new URL(origin)
    if (h.scheme && `${h.scheme.toLowerCase()}:` !== o.protocol) return false
    const d = new URL(`${h.scheme ? h.scheme : o.protocol.slice(0, -1)}://${h.domain}`)
    if (d.pathname !== '/' || d.search || d.hash) return false   // A domain may only be "host[:port]"
    if (d.hostname.toLowerCase() !== o.hostname.toLowerCase()) return false
    if (d.port !== '' && d.port !== o.port) return false          // URL normalizes default ports to empty — writing :443 is the same as not writing it
    if (d.username !== '' && d.username !== o.username) return false
    return true
  } catch {
    return false
  }
}

/** The domain is 0x4's own (420.meme and its subdomains, the web domains): such SIWE / SIWS can only be challenges issued by 0x4's server */
export function isOx4Domain(domain: string): boolean {
  let host: string
  try { host = new URL(`https://${domain}`).hostname.toLowerCase().replace(/\.$/, '') } catch { host = domain.toLowerCase() }
  return host === '420.meme' || host.endsWith('.420.meme') || WEB_DOMAINS.includes(host)
}

/**
 * Parse byte-by-byte against the server's mobile-app login template (SIWS, siwxMessage + LOGIN_STATEMENT_APP); any single char off returns null.
 * (Web login is 0x-address SIWE — see loginMessage.ts parseWebLoginMessage.) domain is returned as-is.
 */
export function parseLoginMessage(message: string): { surface: 'app'; domain: string; address: string; nonce: string; issuedAt: string } | null {
  if (typeof message !== 'string' || message.length > 800) return null
  const m = /^([a-z0-9.-]+(?::\d+)?) wants you to sign in with your Solana account:\n([1-9A-HJ-NP-Za-km-z]{32,44})\n\n([^\n]+)\n\nURI: [^\n]+\nVersion: 1\nChain ID: mainnet\nNonce: ([0-9a-f]{16,64})\nIssued At: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\nExpiration Time: [^\n]+$/.exec(message)
  if (!m) return null
  const [, domain, address, statement, nonce, issuedAt] = m
  if (statement !== LOGIN_STATEMENT_APP) return null
  const rebuilt = siwxMessage({ domain, chain: 'solana', address, statement, nonce, issuedAt })
  return rebuilt === message ? { surface: 'app', domain, address, nonce, issuedAt } : null
}
