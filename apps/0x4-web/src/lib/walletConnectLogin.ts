// Web "scan with mobile wallet" connection (2026-09-30 goat: external wallets can connect too). Dynamically loaded only when the user picks this option — not in the main bundle.
//
// Separate from lib/walletConnect.ts (linking a wallet to grab an NFT avatar — signs one message then disconnects); each uses its own connection instance:
// this one stays connected, routing login signatures and spot trades to the mobile wallet for confirmation. Wrapped as EIP-1193 and handed to the lib/vault/external flow,
// so upper layers (wallet state, login, sending) follow the same path as browser extension wallets.
// EVM only: login signatures, structured data, sending, chain switching. DMs, perps, and Bitcoin are 0x4 Wallet exclusives and were never offered to external wallets anyway.
import UniversalProvider from '@walletconnect/universal-provider'
import { WALLETCONNECT_ID as PROJECT_ID } from '@/lib/env'
import { currentWebDomain } from '@/lib/siwx'
import { t } from '@/lib/i18n'
import { ExternalWalletError, type Eip1193Provider } from '@/lib/vault/external'

type UP = Awaited<ReturnType<typeof UniversalProvider.init>>

/** Chains requested from the mobile wallet (BNB Chain first). Chains the wallet doesn't support are dropped by the wallet itself */
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
      // Must be the web client's current domain: the mobile wallet compares it against the site in the login message (lib/siwx currentWebDomain — the login challenge carries the same one)
      url: `https://${currentWebDomain()}`,
      icons: ['https://app.420.meme/icons/icon.svg'],
    },
  })
  return up
}

export interface WcConnected { provider: Eip1193Provider; address: string; name: string }

/** Wrap the connection instance as EIP-1193: requests carry the current chain (chainId maintained by chain-switch requests; switching only within session-approved chains) */
function asEip1193(p: UP, address: string, chains: number[]): Eip1193Provider {
  let current = chains.includes(56) ? 56 : chains[0]
  return {
    async request({ method, params }) {
      if (method === 'eth_chainId') return `0x${current.toString(16)}`
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address]
      if (method === 'wallet_switchEthereumChain') {
        const want = parseInt(String((params as { chainId?: string }[] | undefined)?.[0]?.chainId ?? ''), 16)
        // Chain not approved in the session: the mobile wallet can't add it — reply 4902 per EIP-3326, and the UI suggests switching wallets
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

/** Existing connection (for restoring after refresh); null when none — pops nothing */
export async function restoreWalletConnect(): Promise<WcConnected | null> {
  if (!PROJECT_ID) return null
  const p = await provider()
  return fromSession(p)
}

function fromSession(p: UP): WcConnected | null {
  const s = p.session
  const accounts = s?.namespaces.eip155?.accounts || []
  if (!s || !accounts.length) return null
  // Account format eip155:<chain id>:<address>
  const address = accounts[0].split(':')[2]
  const chains = [...new Set(accounts.map((a) => Number(a.split(':')[1])))].filter((n) => Number.isFinite(n))
  return { provider: asEip1193(p, address, chains), address, name: s.peer.metadata.name || t('手机钱包') }
}

export interface WcHandle { uri: string; done: Promise<WcConnected>; cancel: () => void }

/** Initiate connection: return the connection URI for the UI's QR code; done yields the address and the wrapped EIP-1193 after the mobile wallet confirms */
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

/** Disconnect the mobile wallet */
export async function endWalletConnect(): Promise<void> {
  if (up?.session) await up.disconnect().catch(() => {})
}
