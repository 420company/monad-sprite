// @vitest-environment jsdom
// Web connecting external wallets (2026-09-30 goat: MetaMask, Phantom, etc. can connect too; perps trading etc. are 0x4 Wallet exclusives).
// What's guarded: EIP-6963 discovery and ordering (0x4 always pinned alone on top, never mixed with third parties), external wallet connect and login (same SIWE, personal_sign),
// Sending txs goes through eth_sendTransaction (external wallets don't offer "sign without sending"), exclusivity gating for exclusive features (external wallets see the exclusivity card, 0x4 Wallet as usual), disconnect and account-switch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { hexToString, recoverMessageAddress, type Hex } from 'viem'
import { Keypair } from '@solana/web3.js'
import type { Ox4Provider } from '@/lib/vault/extension'

vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))
// These cases test login itself; "agree to terms first" (2026-10-02, lib/safety.ts) is covered by safety.test.ts — here everything counts as already agreed
vi.mock('@/lib/safety', async (orig) => ({ ...(await orig<typeof import('@/lib/safety')>()), termsAccepted: () => true }))

const { sortWallets, safeIcon, discoverWallets, useWalletDiscovery, OX4_RDNS } = await import('@/lib/vault/external')
const { connectExternal, disconnectWallet, needWallet, restoreWallet, useWalletGate, connectOx4 } = await import('./walletGate')
const { useWallet, isWalletConnected } = await import('@/store/wallet')
const { useSocial } = await import('@/store/social')
const { setToken } = await import('@/lib/social')
const { walletClientFor } = await import('@/lib/evm')
const { default: Ox4Only } = await import('./Ox4Only')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
/** Really renders into jsdom (server-side rendering can't read the store's current state) */
async function renderHtml(el: React.ReactElement): Promise<string> {
  const div = document.createElement('div')
  const root = createRoot(div)
  await act(async () => { root.render(el) })
  const html = div.innerHTML
  await act(async () => { root.unmount() })
  return html
}

class NoSocket { readyState = 0; onopen = null; onclose = null; onmessage = null; send() {} close() {} }

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+'
const info = (name: string, rdns: string) => ({ uuid: `${rdns}-uuid`, name, icon: ICON, rdns })

/** Fake EIP-1193 wallet: signs personal_sign with a real private key, records every request */
function fakeEip1193(opts: { chainId?: number; reject?: boolean } = {}) {
  const acc = privateKeyToAccount(generatePrivateKey())
  const calls: { method: string; params?: unknown }[] = []
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
  let chainId = opts.chainId ?? 1
  const provider = {
    async request({ method, params }: { method: string; params?: unknown }) {
      calls.push({ method, params })
      if (method === 'eth_requestAccounts') { if (opts.reject) throw { code: 4001, message: 'User rejected' }; return [acc.address] }
      if (method === 'eth_accounts') return [acc.address]
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`
      if (method === 'wallet_switchEthereumChain') { chainId = parseInt((params as { chainId: string }[])[0].chainId, 16); return null }
      if (method === 'personal_sign') { const [data] = params as [Hex, string]; return acc.signMessage({ message: { raw: data } }) }
      if (method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32)
      if (method === 'wallet_revokePermissions') return null
      throw { code: 4200, message: 'unsupported' }
    },
    on(e: string, cb: (...a: unknown[]) => void) { (handlers[e] ||= []).push(cb) },
    removeListener(e: string, cb: (...a: unknown[]) => void) { handlers[e] = (handlers[e] || []).filter((x) => x !== cb) },
  }
  return { provider, acc, calls, emit: (e: string, ...a: unknown[]) => (handlers[e] || []).forEach((cb) => cb(...a)) }
}

/** Local fake server: issues SIWE nonces, verifies login signatures (really recovers the signer from the message) */
function fakeServer() {
  const verified: { address: string; chainType: string; signer: string }[] = []
  let message = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
    if (path === '/api/auth/nonce') { message = `0x4-site.vercel.app wants you to sign in with your Ethereum account:\nnonce ${Math.random()}`; return j({ nonce: 'n1', issuedAt: 't', message }) }
    if (path === '/api/auth/verify') {
      const b = JSON.parse(String(init?.body))
      const signer = await recoverMessageAddress({ message, signature: b.signature })
      verified.push({ address: b.address, chainType: b.chainType, signer })
      if (signer.toLowerCase() !== String(b.address).toLowerCase()) return j({ error: '签名无效' }, 401)
      return j({ token: 'T1', user: { address: 'AcctSolana111', nickname: 'User100', encPub: null, evmVerified: true } })
    }
    if (path === '/api/me') return j({ address: 'AcctSolana111', nickname: 'User100', evmVerified: true })
    return j(path.endsWith('s') || path.includes('groups') ? [] : {})
  }))
  return { verified }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoSocket)
  localStorage.clear()
  useSocial.getState().logout()
  useWallet.getState().detachExtension()
  useWalletGate.setState({ open: false, getOx4: false, connecting: false })
  useWalletDiscovery.setState({ wallets: [] })
  setToken(null)
})
afterEach(() => { delete (window as unknown as { ox4?: unknown }).ox4; delete (window as unknown as { phantom?: unknown }).phantom; vi.unstubAllGlobals() })

describe('EIP-6963 发现与排序', () => {
  it('0x4 插件自己的公告不进第三方列表；MetaMask、Phantom 在前，其余按名字；重复公告只留一个', () => {
    const p = { request: async () => null }
    const list = sortWallets([
      { info: info('Zeta', 'com.zeta'), provider: p },
      { info: info('0x4', OX4_RDNS), provider: p },
      { info: info('Phantom', 'app.phantom'), provider: p },
      { info: info('Alpha', 'com.alpha'), provider: p },
      { info: info('MetaMask', 'io.metamask'), provider: p },
      { info: info('MetaMask', 'io.metamask'), provider: p },
    ])
    expect(list.map((w) => w.info.name)).toEqual(['MetaMask', 'Phantom', 'Alpha', 'Zeta'])
  })
  it('钱包图标只收 data:image，别的地址不拿来当图片', () => {
    expect(safeIcon(ICON)).toBe(ICON)
    expect(safeIcon('https://evil.example/x.png')).toBeNull()
    expect(safeIcon('javascript:alert(1)')).toBeNull()
  })
  it('收到钱包公告后进列表并排好', () => {
    useWalletDiscovery.setState({ wallets: [] })
    const p = { request: async () => null }
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: info('Rabby', 'io.rabby'), provider: p } }))
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: info('MetaMask', 'io.metamask'), provider: p } }))
    }, { once: true })
    discoverWallets()
    expect(useWalletDiscovery.getState().wallets.map((w) => w.info.name)).toEqual(['MetaMask', 'Rabby'])
  })
})

describe('外部钱包连接和登录', () => {
  it('连上：EVM 地址挂到钱包上，没有 Solana / 私信 / 比特币；算「已连接」，needWallet 不再拦', async () => {
    const f = fakeEip1193()
    expect(await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })).toBe(true)
    const w = useWallet.getState()
    expect(w.kind).toBe('external')
    expect(w.evmAddress).toBe(f.acc.address)
    expect(w.wallet).toBeNull()
    expect(w.dm).toBeNull()
    expect(w.btcAddress).toBeNull()
    expect(w.external?.name).toBe('MetaMask')
    expect(isWalletConnected(w)).toBe(true)
    expect(needWallet()).toBe(false)
    expect(localStorage.getItem('0x4.lastExternal')).toBe('io.metamask')
  })
  it('用户在钱包里拒绝连接：不挂、不报红字', async () => {
    const f = fakeEip1193({ reject: true })
    expect(await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })).toBe(false)
    expect(isWalletConnected(useWallet.getState())).toBe(false)
  })
  it('登录：同一条 SIWE 消息，用外部钱包的 personal_sign 签，服务器按 0x 地址验到的签名人就是它', async () => {
    const srv = fakeServer()
    const f = fakeEip1193()
    await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })
    await useSocial.getState().login()
    expect(useSocial.getState().status).toBe('ready')
    expect(srv.verified).toHaveLength(1)
    expect(srv.verified[0].chainType).toBe('evm')
    expect(srv.verified[0].signer.toLowerCase()).toBe(f.acc.address.toLowerCase())
    const signed = f.calls.find((c) => c.method === 'personal_sign')!.params as [Hex, string]
    expect(hexToString(signed[0])).toContain('wants you to sign in with your Ethereum account')
    expect(signed[1]).toBe(f.acc.address)
  })
  it('Phantom：EVM 之外把 Solana 也接上（Solana 现货能用）', async () => {
    const kp = Keypair.generate()
    ;(window as unknown as { phantom: unknown }).phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: kp.publicKey }), signTransaction: async (x: unknown) => x, signMessage: async () => ({ signature: new Uint8Array(64) }) } }
    const f = fakeEip1193()
    await connectExternal({ info: info('Phantom', 'app.phantom'), provider: f.provider })
    const w = useWallet.getState()
    expect(w.address).toBe(kp.publicKey.toBase58())
    expect(w.wallet?.publicKey.toBase58()).toBe(kp.publicKey.toBase58())
    expect(w.kind).toBe('external')
  })
  it('刷新页面：上次连的外部钱包还授权着就不弹窗挂回来（eth_accounts，不是 eth_requestAccounts）', async () => {
    const f = fakeEip1193()
    localStorage.setItem('0x4.lastExternal', 'io.metamask')
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: info('MetaMask', 'io.metamask'), provider: f.provider } }))
    }, { once: true })
    await restoreWallet()
    expect(useWallet.getState().evmAddress).toBe(f.acc.address)
    expect(f.calls.some((c) => c.method === 'eth_requestAccounts')).toBe(false)
  })
  it('钱包里断开所有账号 / 换了账号：断开 / 按新地址重挂', async () => {
    const f = fakeEip1193()
    await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })
    const other = privateKeyToAccount(generatePrivateKey()).address
    f.emit('accountsChanged', [other])
    expect(useWallet.getState().evmAddress).toBe(other)
    f.emit('accountsChanged', [])
    await new Promise((r) => setTimeout(r, 0))
    expect(isWalletConnected(useWallet.getState())).toBe(false)
  })
  it('断开钱包：本地清掉、顺带请钱包撤掉网站授权、不再自动恢复', async () => {
    const f = fakeEip1193()
    await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })
    await disconnectWallet()
    await new Promise((r) => setTimeout(r, 0))
    expect(isWalletConnected(useWallet.getState())).toBe(false)
    expect(localStorage.getItem('0x4.lastExternal')).toBeNull()
    expect(f.calls.some((c) => c.method === 'wallet_revokePermissions')).toBe(true)
  })
  it('没装 0x4 插件时点 0x4 Wallet：弹「获取 0x4 Wallet」（没配商店地址 = 即将上线），不去连外部钱包', async () => {
    expect(await connectOx4()).toBe(false)
    expect(useWalletGate.getState().getOx4).toBe(true)
  })
})

describe('发交易：外部钱包自己签、自己发', () => {
  it('先切到要用的链，再 eth_sendTransaction（不走「签好交回来」）', async () => {
    const f = fakeEip1193({ chainId: 1 })
    await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })
    const account = useWallet.getState().evmAccount!
    const client = await walletClientFor(account, 56)
    const hash = await client.sendTransaction({ chain: client.chain, to: '0x000000000000000000000000000000000000dEaD', value: 1n, account: account.address })
    expect(hash).toBe('0x' + 'ab'.repeat(32))
    const methods = f.calls.map((c) => c.method)
    expect(methods).toContain('wallet_switchEthereumChain')
    expect(methods).toContain('eth_sendTransaction')
    expect(methods.indexOf('wallet_switchEthereumChain')).toBeLessThan(methods.indexOf('eth_sendTransaction'))
  })
})

describe('0x4 Wallet 专属门禁', () => {
  const render = () => renderHtml(createElement(Ox4Only, { feature: 'perp', children: createElement('div', null, 'PERP-PAGE') }))
  it('外部钱包：合约页换成「0x4 Wallet 专属」卡，有「获取 0x4 Wallet」', async () => {
    const f = fakeEip1193()
    await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })
    const html = await render()
    expect(html).not.toContain('PERP-PAGE')
    expect(html).toContain('0x4 Wallet 专属')
    expect(html).toContain('获取 0x4 Wallet')
  })
  it('对照：0x4 插件连着（或没连钱包）时照常显示原页面', async () => {
    const p = { isOx4: true, on: () => {}, off: () => {} } as unknown as Ox4Provider
    useWallet.getState().attachExtension(p, { address: Keypair.generate().publicKey.toBase58(), evmAddress: privateKeyToAccount(generatePrivateKey()).address, btcAddress: '' }, async () => {})
    expect(await render()).toContain('PERP-PAGE')
    useWallet.getState().detachExtension()
    expect(await render()).toContain('PERP-PAGE')
  })
  it('私信、小精灵全自动、比特币也是专属（各自一行短说明）', async () => {
    const f = fakeEip1193()
    await connectExternal({ info: info('MetaMask', 'io.metamask'), provider: f.provider })
    for (const [feature, line] of [['dm', '私信'], ['auto', '小精灵全自动'], ['btc', '比特币']] as const) {
      const html = await renderHtml(createElement(Ox4Only, { feature, children: 'X' }))
      expect(html).toContain('0x4 Wallet 专属')
      expect(html).toContain(line)
    }
  })
})
