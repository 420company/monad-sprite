// 带域名的标准签名消息（2026-09-30 防钓鱼改造）：EVM = EIP-4361「Sign-In with Ethereum」，Solana = SIWS「Sign In With Solana」。
// 服务器 server/src/siwx.ts 出题，这里是同一套模板（逐字一致，两边测试用同一段样例文本）加上 0x4 浏览器插件要用的解析 / 比对：
//   · webLoginMessageFor / parseLoginMessage：网页版 0x 登录的 SIWE、App 登录的 SIWS（插件 signLogin 只签网页版那一种，解析在 loginMessage.ts）
//   · siwxHeaders / siwxMatchesOrigin：任何网站请插件签一段 SIWE / SIWS 文本，消息里的 domain 必须就是发起请求的网站（和 MetaMask、Phantom 一样）
//   · isOx4Domain：消息 domain 是 0x4 自己的域名 → 通用签名入口一律拒签（钓鱼站拿 0x4 的消息来骗签）
// ★statement 只能用 ASCII（MetaMask 的 SIWE 解析器按 EIP-4361 ABNF 严格解析，带中文就认不出是 SIWE、也就不比对域名）。
import { getAddress } from 'viem'
import { createSiweMessage } from 'viem/siwe'

/** 手机 App 的登录、App 里的关联钱包（= App 里 WalletConnect 元数据 url 的主机名，src/lib/walletConnect.ts） */
export const APP_DOMAIN = 'app.420.meme'
/** 电脑网页版原来的域名（不在 WEB_DOMAINS 里的地方，比如本机开发、预览地址，都按它出题）。和 server/src/siwx.ts 一致 */
export const WEB_DOMAIN = '0x4-site.vercel.app'
/**
 * 网页版可以在的全部域名（2026-09-30 goat：420.meme 以后做网页版主站，切换步骤见 docs/DOMAIN_SWITCH.md）。
 * 和 server/src/siwx.ts WEB_DOMAINS 一致；插件信任来源（extension/src/shared/protocol.ts OX4_ORIGINS）按切换进度另外加
 */
export const WEB_DOMAINS: readonly string[] = [WEB_DOMAIN, '420.meme']
/** 网页版现在所在的域名：在名单里就用它（取题时带给服务器，登录消息 domain 就是它），否则按原域名 */
export function currentWebDomain(): string {
  const h = typeof location !== 'undefined' ? location.host : ''
  return WEB_DOMAINS.includes(h) ? h : WEB_DOMAIN
}
/** 网页版登录（0x 地址 + SIWE，2026-09-30）写的链号：BSC 主网 */
export const WEB_LOGIN_CHAIN_ID = 56
export const SIWX_TTL_MS = 5 * 60_000

export type SiwxChain = 'solana' | 'evm'

export const LOGIN_STATEMENT_APP = 'Sign in to the 0x4 app with this wallet. This will not send a transaction or cost any gas fees.'
export const LOGIN_STATEMENT_WEB = 'Sign in to the 0x4 web app with this wallet. This will not send a transaction or spend any funds.'
export const walletLinkStatement = (account: string) =>
  `Link this wallet to 0x4 account ${account}. This only proves you own this wallet. It will not send a transaction or cost any gas fees.`

/** 按 EIP-4361 / SIWS 文本格式拼消息（和 server/src/siwx.ts siwxMessage 逐字一致） */
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
 * 电脑网页版登录（2026-09-30 goat 定：网页版用 0x 地址登录）：0x4 插件用 EVM 私钥签的 EIP-4361（SIWE），
 * 和服务器 server/src/siwx.ts webLoginMessage 逐字一致（domain = 网页版所在的域名，WEB_DOMAINS 之一）。插件解析时也按消息里写的 domain 重建比对。
 */
export function webLoginMessageFor(domain: string, evmAddress: string, nonce: string, issuedAt: string): string {
  const t = Date.parse(issuedAt)
  return createSiweMessage({
    domain, address: getAddress(evmAddress.toLowerCase()), statement: LOGIN_STATEMENT_WEB, uri: `https://${domain}`,
    version: '1', chainId: WEB_LOGIN_CHAIN_ID, nonce, issuedAt: new Date(t), expirationTime: new Date(t + SIWX_TTL_MS),
  })
}

/** 关联其他钱包的消息（服务器 /api/me/wallets/challenge 出题，这里只给测试和插件拦截用） */
export function walletLinkMessage(account: string, address: string, nonce: string, issuedAt: string, web = false, webDomain: string = WEB_DOMAIN): string {
  const evm = address.startsWith('0x')
  return siwxMessage({
    domain: web ? webDomain : APP_DOMAIN, chain: evm ? 'evm' : 'solana', address: evm ? getAddress(address.toLowerCase()) : address,
    statement: walletLinkStatement(account), nonce, issuedAt,
  })
}

// ---------- 解析与比对（给 0x4 浏览器插件用） ----------

/** 零宽字符、BOM、软连字符先去掉再判断（钓鱼站可能夹在域名里） */
export const stripInvisible = (s: string) => s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')

/**
 * 找出消息里所有「<domain> wants you to sign in with your <X> account:」行（SIWE / SIWS 的第一行）。
 * 规范要求在第一行；这里每一行都看、空白和大小写放宽（宁可多认，钓鱼站在前面垫几行字也逃不过）。
 * scheme = 规范允许在 domain 前写的「https://」这种前缀（没有就是 undefined）
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
 * SIWE / SIWS 的 domain 和发起请求的网站（origin，浏览器给的 sender.origin）对不对得上。
 * 规则照 MetaMask（@metamask/controller-utils isValidSIWEOrigin）：主机名必须相同（不分大小写）；domain 写了端口就必须和来源一致
 * （写的是默认端口也算）；写了用户名就必须一致。另外 domain 前写了 scheme 的，scheme 也要一致。解析不了一律算对不上。
 */
export function siwxMatchesOrigin(h: { scheme?: string; domain: string }, origin: string): boolean {
  try {
    const o = new URL(origin)
    if (h.scheme && `${h.scheme.toLowerCase()}:` !== o.protocol) return false
    const d = new URL(`${h.scheme ? h.scheme : o.protocol.slice(0, -1)}://${h.domain}`)
    if (d.pathname !== '/' || d.search || d.hash) return false   // domain 只能是「主机[:端口]」
    if (d.hostname.toLowerCase() !== o.hostname.toLowerCase()) return false
    if (d.port !== '' && d.port !== o.port) return false          // URL 会把默认端口规范成空，写 :443 也等于没写
    if (d.username !== '' && d.username !== o.username) return false
    return true
  } catch {
    return false
  }
}

/** domain 是 0x4 自己的（420.meme 及其子域名、网页版域名）：这种 SIWE / SIWS 只可能是 0x4 服务器出的题 */
export function isOx4Domain(domain: string): boolean {
  let host: string
  try { host = new URL(`https://${domain}`).hostname.toLowerCase().replace(/\.$/, '') } catch { host = domain.toLowerCase() }
  return host === '420.meme' || host.endsWith('.420.meme') || WEB_DOMAINS.includes(host)
}

/**
 * 按服务器的手机 App 登录模板（SIWS，siwxMessage + LOGIN_STATEMENT_APP）逐字解析；有任何一个字对不上返回 null。
 * （网页版登录是 0x 地址的 SIWE，解析见 loginMessage.ts parseWebLoginMessage。）domain 原样返回。
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
