// 网页版「手机钱包扫码」连接（2026-09-30 goat：外部钱包也能连进来用）。只在用户点这一项时动态加载，主包里没有它。
//
// 和 lib/walletConnect.ts（关联钱包拿 NFT 头像，只签一条消息就断开）是两件事，各用各的连接实例：
// 这里连上后一直保持，登录签名、现货买卖都通过它请手机钱包确认。包成 EIP-1193 的样子交给 lib/vault/external 那套，
// 上层（钱包状态、登录、发交易）和浏览器扩展钱包走同一条路。
// 只要 EVM：登录签名、结构化数据、发交易、切链。私信、合约、比特币这些 0x4 Wallet 专属功能本来就不给外部钱包。
import UniversalProvider from '@walletconnect/universal-provider'
import { WALLETCONNECT_ID as PROJECT_ID } from '@/lib/env'
import { currentWebDomain } from '@/lib/siwx'
import { t } from '@/lib/i18n'
import { ExternalWalletError, type Eip1193Provider } from '@/lib/vault/external'

type UP = Awaited<ReturnType<typeof UniversalProvider.init>>

/** 请手机钱包开放的链（BNB Chain 排第一）。钱包不支持的链会被它自己去掉 */
const CHAINS = [56, 1, 8453, 42161, 137, 10, 43114]
const METHODS = ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction', 'eth_chainId', 'eth_accounts', 'wallet_switchEthereumChain']

let up: UP | null = null
async function provider(): Promise<UP> {
  if (!PROJECT_ID) throw new Error(t('暂时无法连接手机钱包'))
  if (up) return up
  up = await UniversalProvider.init({
    projectId: PROJECT_ID,
    metadata: {
      name: '0x4',
      description: '0x4',
      // 必须是网页版当前所在的域名：手机钱包拿它和登录消息里的网站比对（lib/siwx currentWebDomain，登录取题也带同一个）
      url: `https://${currentWebDomain()}`,
      icons: ['https://app.420.meme/icons/icon.svg'],
    },
  })
  return up
}

export interface WcConnected { provider: Eip1193Provider; address: string; name: string }

/** 把连接实例包成 EIP-1193：请求带上当前链（chainId 由切链请求维护，只能在会话开放的链之间切） */
function asEip1193(p: UP, address: string, chains: number[]): Eip1193Provider {
  let current = chains.includes(56) ? 56 : chains[0]
  return {
    async request({ method, params }) {
      if (method === 'eth_chainId') return `0x${current.toString(16)}`
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address]
      if (method === 'wallet_switchEthereumChain') {
        const want = parseInt(String((params as { chainId?: string }[] | undefined)?.[0]?.chainId ?? ''), 16)
        // 会话里没开放这条链：手机钱包那边加不了，照 EIP-3326 回 4902，界面提示换用别的钱包
        if (!chains.includes(want)) throw new ExternalWalletError(4902, t('手机钱包没有开放这条链'))
        current = want
        return null
      }
      if (method === 'wallet_addEthereumChain') throw new ExternalWalletError(4200, t('手机钱包没有开放这条链'))
      return p.request({ method, params: params as unknown[] }, `eip155:${current}`)
    },
    on: (e, cb) => p.on(e, cb),
    removeListener: (e, cb) => p.removeListener(e, cb),
  }
}

/** 已有的连接（刷新页面后恢复用）；没有返回 null，不弹任何东西 */
export async function restoreWalletConnect(): Promise<WcConnected | null> {
  if (!PROJECT_ID) return null
  const p = await provider()
  return fromSession(p)
}

function fromSession(p: UP): WcConnected | null {
  const s = p.session
  const accounts = s?.namespaces.eip155?.accounts || []
  if (!s || !accounts.length) return null
  // 账号格式 eip155:<链号>:<地址>
  const address = accounts[0].split(':')[2]
  const chains = [...new Set(accounts.map((a) => Number(a.split(':')[1])))].filter((n) => Number.isFinite(n))
  return { provider: asEip1193(p, address, chains), address, name: s.peer.metadata.name || t('手机钱包') }
}

export interface WcHandle { uri: string; done: Promise<WcConnected>; cancel: () => void }

/** 发起连接：返回连接串给界面出二维码，done 在手机钱包确认后给出地址和包好的 EIP-1193 */
export async function beginWalletConnect(): Promise<WcHandle> {
  const p = await provider()
  if (p.session) await p.disconnect().catch(() => {})
  let resolveUri: (u: string) => void
  const uriReady = new Promise<string>((r) => { resolveUri = r })
  const onUri = (uri: string) => resolveUri(uri)
  p.on('display_uri', onUri)
  const session = p.connect({
    optionalNamespaces: {
      eip155: { methods: METHODS, chains: CHAINS.map((c) => `eip155:${c}`), events: ['accountsChanged', 'chainChanged'] },
    },
  })
  const done = (async () => {
    const s = await session
    p.removeListener('display_uri', onUri)
    if (!s) throw new ExternalWalletError(4001, t('已取消'))
    const c = fromSession(p)
    if (!c) throw new ExternalWalletError(5000, t('手机钱包没有返回地址'))
    return c
  })()
  return { uri: await uriReady!, done, cancel: () => { p.removeListener('display_uri', onUri); void p.disconnect().catch(() => {}) } }
}

/** 断开手机钱包 */
export async function endWalletConnect(): Promise<void> {
  if (up?.session) await up.disconnect().catch(() => {})
}
