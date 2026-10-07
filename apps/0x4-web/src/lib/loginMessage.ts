// 0x4 登录消息（服务器 server/src/siwx.ts 的 loginMessage / webLoginMessage 出题，钱包签名）。格式两边必须逐字一致。
// 2026-09-30 起是带域名的标准格式，模板在 src/lib/siwx.ts：
//   · 手机 App：Solana 地址 + SIWS（Sign In With Solana），domain = app.420.meme。App 原样签服务器给的 message，不在这里组装。
//   · 电脑网页版（goat 定：用 0x 地址登录）：插件的 EVM 私钥签 SIWE（EIP-4361），domain = 网页版域名、Chain ID 56
//     （/api/auth/nonce?address=0x…&surface=web 发）。服务器按命中的模板决定令牌带不带网页标记，网页版令牌不能批准电脑端 / 管理后台的扫码登录。
// 0x4 浏览器插件只签网页版模板（parseWebLoginMessage 认出「这确实是一条 0x4 网页版登录消息」，插件再核对地址是自己的 EVM 地址、
// domain 就是发起请求的网站），App 模板一律拒签：否则网页同源的恶意脚本能让插件签 App 模板，换到能批准管理后台扫码的 App 令牌。
// Phantom、MetaMask 这类第三方钱包认得这种格式，钓鱼站拿这些消息骗签时会警告或拒签。
import { parseSiweMessage } from 'viem/siwe'
import { APP_DOMAIN, WEB_DOMAIN, LOGIN_STATEMENT_APP, isOx4Domain, siwxHeaders, siwxMessage, stripInvisible, webLoginMessageFor } from './siwx'

export function loginMessage(address: string, nonce: string, issuedAt: string): string {
  return siwxMessage({ domain: APP_DOMAIN, chain: 'solana', address, statement: LOGIN_STATEMENT_APP, nonce, issuedAt })
}

/** 网页版登录（0x 地址 + SIWE），evmAddress 大小写都行（消息里写 EIP-55 校验和）。domain 默认原网页版域名，420.meme 上的网页版传 420.meme */
export function webLoginMessage(evmAddress: string, nonce: string, issuedAt: string, domain: string = WEB_DOMAIN): string {
  return webLoginMessageFor(domain, evmAddress, nonce, issuedAt)
}

/** 2026-09-30 以前的两套登录模板（服务器已不再认，只用来识别、拒签；网页版那套当时还是 Solana 签名） */
export function legacyLoginMessage(address: string, nonce: string, issuedAt: string): string {
  return `0x4 登录\n\n地址: ${address}\nNonce: ${nonce}\n时间: ${issuedAt}\n\n签名不会发起任何链上交易，也不会花费 Gas。`
}
export function legacyWebLoginMessage(address: string, nonce: string, issuedAt: string): string {
  return `0x4 网页版登录\n\n地址: ${address}\nNonce: ${nonce}\n时间: ${issuedAt}\n\n签名不会发起任何链上交易，也不会花费 Gas。`
}

/**
 * 按服务器的网页版模板（0x 地址的 SIWE）解析；有任何一个字对不上（包括 App 模板、旧模板、多写了字段）返回 null。
 * address 是消息里的 EIP-55 写法；domain 原样返回：插件要核对它就是发起请求的网站、地址是自己的（extension/src/background/ox4.ts signLogin）
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
 * 看起来是 0x4 的登录消息 / 关联钱包消息 / EVM 关联消息（lib/evmLink）：只要沾边就算，宁可多拦。
 * 0x4 浏览器插件的通用签名入口（给别的网站用的 personal_sign、网页调的 signEvmMessage / signSolanaMessage）
 * 遇到这类消息一律拒签（2026-09-29 安全审查：钓鱼站用通用签名骗签这些消息，就能冒领受害者的地址）。
 *   · 旧模板：「0x4 …登录」「网页版登录」「0x4 wallet link」
 *   · 新模板（2026-09-30）：SIWE / SIWS 第一行的 domain 是 0x4 自己的域名（420.meme 及其子域名、网页版域名）。
 *     别的网站自己的 SIWE（domain 不是我们的）不在这里拦，交给插件的域名比对（policy.ts refuseSiwxMismatch）。
 * 零宽字符、BOM 先去掉再判断。「0x4」和「登录」之间隔着同一行里的几个字（网页版、钱包……）也算。
 */
export function looksLikeOx4AuthMessage(message: string): boolean {
  if (typeof message !== 'string') return false
  const s = stripInvisible(message)   // 零宽空格 / 零宽不连字 / 零宽连字、词连接符、BOM、软连字符
  if (/0x4[^\n]{0,20}?登[录錄]/i.test(s) || /[网網]\s*[页頁]\s*版\s*登[录錄]/.test(s) || /0x4\s*wallet\s*link/i.test(s)) return true
  return siwxHeaders(s).some((h) => isOx4Domain(h.domain))
}
