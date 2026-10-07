// Connecting an external wallet serves one purpose only: have it sign a message proving "this address is also mine",
// so its NFTs can later be used as avatars.
//
// Boundaries (important):
//   - This module only requests signatures; it never sends transactions and never touches the other side's private keys.
//   - It's dynamically loaded only when the user taps "Link wallet" — the main bundle doesn't include it.
//   - Login, trading and transfers never go through here; 0x4's own wallets stay on the self-custodied private-key flow.
import UniversalProvider from '@walletconnect/universal-provider'
import { walletChallenge, linkWallet } from '@/lib/linkedWallets'
import { isNative, openExternal } from '@/lib/native'

import { WALLETCONNECT_ID as PROJECT_ID } from '@/lib/env'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'
import { APP_DOMAIN, currentWebDomain } from '@/lib/siwx'

/** The user closed the connect window themselves / tapped reject in the wallet */
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
      // ★ Must match the domain in the server's link-wallet messages (EIP-4361 / SIWS) (server/src/siwx.ts, 2026-09-30):
      // MetaMask mobile treats this url (or the WalletConnect Verify-verified web origin) as the "requesting site" and compares it against the message domain — a mismatch gets a red warning.
      // Mobile app = app.420.meme (apps installed after 9/27 carry this; the server issues app.420.meme challenges based on the app token);
      // Desktop web = the web app's current domain (sent to the server when fetching the challenge; the server issues per it, matching the Verify-verified real web origin; since 2026-09-30 it may be 420.meme)
      url: `https://${WEB_SURFACE ? currentWebDomain() : APP_DOMAIN}`,
      icons: ['https://app.420.meme/icons/icon.svg'],
    },
  })
  return provider
}

export interface ConnectHandle {
  /** A wc:-prefixed connection URI, used to render a QR code or deep-link into a wallet app */
  uri: string
  /** Wait for the user to confirm the connection in the wallet, then sign; the address is linked once done */
  done: Promise<void>
  cancel: () => void
}

/**
 * Start the connection and sign the association.
 * Returns the connection URI for the UI to render a QR code (desktop) or deep-link to a wallet (mobile); done means the association succeeded.
 */
export async function beginLinkWallet(): Promise<ConnectHandle> {
  const p = await getProvider()
  let resolveUri: (u: string) => void
  const uriReady = new Promise<string>((r) => { resolveUri = r })
  p.on('display_uri', (uri: string) => resolveUri(uri))

  const session = p.connect({
    optionalNamespaces: {
      // EVM: mainstream NFTs live on these chains. Only personal_sign is needed — never transaction permission
      eip155: {
        methods: ['personal_sign'],
        // Include a few more NFT-common chains (ApeChain / Zora / Abstract / Berachain),
        // so the wallet connects no matter which chain it's currently on; we only need the signature, the chain itself doesn't matter
        chains: ['eip155:1', 'eip155:8453', 'eip155:42161', 'eip155:137', 'eip155:10', 'eip155:56',
          'eip155:33139', 'eip155:7777777', 'eip155:2741', 'eip155:80094'],
        events: ['accountsChanged', 'chainChanged'],
      },
      // Solana mainnet
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
    // Account format is "eip155:1:0xabc…" / "solana:<chain>:<address>"
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

/** personal_sign wants the message in hex */
function hexOf(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Solana signatures come back base58; the wallet returns a { signature } structure */
async function signSolana(p: Awaited<ReturnType<typeof UniversalProvider.init>>, account: string, message: string): Promise<string> {
  const address = account.split(':')[2]
  const chain = account.split(':').slice(0, 2).join(':')
  const r = await p.request<{ signature: string }>({
    method: 'solana_signMessage',
    params: { message: btoa(unescape(encodeURIComponent(message))), pubkey: address },
  }, chain)
  return r.signature
}

/** On phones, hand the connection URI straight to the wallet app; when unsure which is installed, let the user pick */
export function openInWallet(uri: string): void {
  const link = `wc://wc?uri=${encodeURIComponent(uri)}`
  if (isNative) void openExternal(link, { holdUnlock: true }).catch(() => {})   // The wallet jumps back after signing; no lock during that time
  else window.location.href = link
}
