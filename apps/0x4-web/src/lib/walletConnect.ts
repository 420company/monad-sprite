// 连接外部钱包，只为一件事：让它签一条消息，证明「这个地址也是我的」，
// 之后它里面的 NFT 才能拿来当头像。
//
// 边界（很重要）：
//   - 这个模块只请求签名，永远不发交易，也不碰对方私钥。
//   - 只在用户点「关联钱包」时才被动态加载，主包里没有它。
//   - 登录、交易、转账一概不走这里，0x4 自己的钱包还是自管私钥那套。
import UniversalProvider from '@walletconnect/universal-provider'
import { walletChallenge, linkWallet } from '@/lib/linkedWallets'
import { isNative, openExternal } from '@/lib/native'

import { WALLETCONNECT_ID as PROJECT_ID } from '@/lib/env'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'
import { APP_DOMAIN, currentWebDomain } from '@/lib/siwx'

/** 用户自己关掉了连接窗口 / 在钱包里点了拒绝 */
export class Cancelled extends Error {
  constructor() { super('CANCELLED') }
}

let provider: Awaited<ReturnType<typeof UniversalProvider.init>> | null = null

async function getProvider() {
  if (!PROJECT_ID) throw new Error(t('暂时无法连接其他钱包'))
  if (provider) return provider
  provider = await UniversalProvider.init({
    projectId: PROJECT_ID,
    metadata: {
      name: '0x4',
      description: '关联钱包以使用其中的 NFT 作为头像',
      // ★必须和服务器关联钱包消息（EIP-4361 / SIWS）里的 domain 一致（server/src/siwx.ts，2026-09-30）：
      // MetaMask 手机版拿这个 url（或 WalletConnect Verify 核实过的网页来源）当「发起请求的网站」和消息 domain 比对，对不上就标红警告。
      // 手机 App = app.420.meme（9/27 以后装的 App 就是这个值，服务器按 App 令牌出 app.420.meme 的题）；
      // 电脑网页版 = 网页版当前所在的域名（取题时带给服务器，服务器按它出题，和 Verify 核实的真实网页来源也一致；2026-09-30 起可能是 420.meme）
      url: `https://${WEB_SURFACE ? currentWebDomain() : APP_DOMAIN}`,
      icons: ['https://app.420.meme/icons/icon.svg'],
    },
  })
  return provider
}

export interface ConnectHandle {
  /** wc: 开头的连接串，用来出二维码或跳转钱包 App */
  uri: string
  /** 等用户在钱包里确认连接、再签名；完成后地址已关联 */
  done: Promise<void>
  cancel: () => void
}

/**
 * 发起连接并签名关联。
 * 返回连接串给界面出二维码（电脑）或跳转钱包（手机），done 完成即表示关联成功。
 */
export async function beginLinkWallet(): Promise<ConnectHandle> {
  const p = await getProvider()
  let resolveUri: (u: string) => void
  const uriReady = new Promise<string>((r) => { resolveUri = r })
  p.on('display_uri', (uri: string) => resolveUri(uri))

  const session = p.connect({
    optionalNamespaces: {
      // EVM：主流 NFT 都在这几条链上。只要 personal_sign，不要交易权限
      eip155: {
        methods: ['personal_sign'],
        // 多带几条 NFT 常见链（ApeChain / Zora / Abstract / Berachain），
        // 钱包当前停在哪条链上都能连上；我们只要签名，不关心链本身
        chains: ['eip155:1', 'eip155:8453', 'eip155:42161', 'eip155:137', 'eip155:10', 'eip155:56',
          'eip155:33139', 'eip155:7777777', 'eip155:2741', 'eip155:80094'],
        events: ['accountsChanged', 'chainChanged'],
      },
      // Solana 主网
      solana: {
        methods: ['solana_signMessage'],
        chains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
        events: [],
      },
    },
  })

  const done = (async () => {
    const s = await session
    if (!s) throw new Cancelled()
    const evm = (s.namespaces.eip155?.accounts || [])[0]
    const sol = (s.namespaces.solana?.accounts || [])[0]
    // 账号格式是 "eip155:1:0xabc…" / "solana:<chain>:<address>"
    const address = evm ? evm.split(':')[2] : sol ? sol.split(':')[2] : ''
    if (!address) throw new Error(t('这个钱包没有返回地址'))
    const chainType: 'evm' | 'solana' = evm ? 'evm' : 'solana'

    const { message, issuedAt } = await walletChallenge(address)
    const signature = chainType === 'evm'
      ? await p.request<string>({
          method: 'personal_sign',
          params: [hexOf(message), address],
        }, evm!.split(':').slice(0, 2).join(':'))
      : await signSolana(p, sol!, message)

    await linkWallet({ address, chainType, signature, issuedAt })
    await p.disconnect().catch(() => {})
  })()

  return { uri: await uriReady!, done, cancel: () => { void p.disconnect().catch(() => {}) } }
}

/** personal_sign 要的是十六进制的消息 */
function hexOf(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Solana 的签名返回 base58，钱包给的是 { signature } 结构 */
async function signSolana(p: Awaited<ReturnType<typeof UniversalProvider.init>>, account: string, message: string): Promise<string> {
  const address = account.split(':')[2]
  const chain = account.split(':').slice(0, 2).join(':')
  const r = await p.request<{ signature: string }>({
    method: 'solana_signMessage',
    params: { message: btoa(unescape(encodeURIComponent(message))), pubkey: address },
  }, chain)
  return r.signature
}

/** 手机上直接把连接串交给钱包 App；拿不准装了哪个就让用户自己选 */
export function openInWallet(uri: string): void {
  const link = `wc://wc?uri=${encodeURIComponent(uri)}`
  if (isNative) void openExternal(link, { holdUnlock: true }).catch(() => {})   // 钱包签完会跳回来，期间不锁
  else window.location.href = link
}
