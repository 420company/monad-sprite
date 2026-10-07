// @vitest-environment jsdom
// 网页版登录走 0x4 浏览器插件：connect 拿地址 → 服务器登录消息 → signLogin → 换令牌（docs/EXTENSION_API.md 第 4 节）
// 2026-09-30 起网页版用插件的 0x 地址登录：服务器发 SIWE，插件用 EVM 私钥签，verify 交 chainType:'evm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyMessage, type Hex } from 'viem'
import type { Ox4Provider } from './extension'

vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))
const { extensionSolanaWallet, getOx4, waitForOx4 } = await import('./extension')
const { loginWithWallet, setToken } = await import('@/lib/social')

const edSign = (m: Uint8Array, kp: Keypair) => ed25519.sign(Uint8Array.from(m), Uint8Array.from(kp.secretKey.slice(0, 32)))

/** 只实现登录用得到的几个方法的假插件 */
function fakeOx4(solKp: Keypair, evmKey: Hex, over: Partial<Ox4Provider> = {}) {
  const calls: { m: string; a: unknown }[] = []
  const evm = privateKeyToAccount(evmKey)
  const p = {
    isOx4: true,
    connect: async () => { calls.push({ m: 'connect', a: null }); return { address: solKp.publicKey.toBase58(), evmAddress: evm.address, btcAddress: '' } },
    signLogin: async ({ message }: { message: string }) => { calls.push({ m: 'signLogin', a: message }); return { signature: await evm.signMessage({ message }), chain: 'evm' as const } },
    signSolanaMessage: async ({ message }: { message: string }) => { calls.push({ m: 'signSolanaMessage', a: message }); return { signature: '' } },
    ...over,
  } as unknown as Ox4Provider
  return { p, calls }
}

afterEach(() => { vi.unstubAllGlobals(); setToken(null); delete (window as unknown as { ox4?: unknown }).ox4 })

describe('发现插件', () => {
  it('没装：getOx4 为空；插件晚注入时等 ox4#initialized 事件', async () => {
    expect(getOx4()).toBeNull()
    const kp = Keypair.generate()
    const { p } = fakeOx4(kp, generatePrivateKey())
    const waiting = waitForOx4(1000)
    setTimeout(() => { (window as unknown as { ox4: Ox4Provider }).ox4 = p; window.dispatchEvent(new Event('ox4#initialized')) }, 10)
    expect(await waiting).toBe(p)
  })
  it('长得像但不是 0x4 插件（没有 isOx4）不认', () => {
    ;(window as unknown as { ox4: unknown }).ox4 = { connect() {} }
    expect(getOx4()).toBeNull()
  })
})


describe('登录', () => {
  it('connect 拿地址 → 服务器登录消息（按 0x 地址要）→ signLogin → 换令牌；服务器收到的就是插件的 EVM 签名，而且能验过', async () => {
    const kp = Keypair.generate()
    const { p, calls } = fakeOx4(kp, generatePrivateKey())
    const acc = await p.connect()
    const w = extensionSolanaWallet(p, acc.address)
    let verifyBody: Record<string, unknown> | null = null
    let nonceUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/nonce')) { nonceUrl = url; return new Response(JSON.stringify({ nonce: 'n1', issuedAt: 't1', message: 'Sign in to 420.meme\nnonce: n1' }), { status: 200 }) }
      if (url.includes('/api/auth/verify')) { verifyBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ token: 'TOKEN', user: { address: acc.address } }), { status: 200 }) }
      return new Response('{}', { status: 404 })
    }))
    const r = await loginWithWallet(w, acc.evmAddress, null)
    expect(r.token).toBe('TOKEN')
    expect(new URL(nonceUrl, 'https://x').searchParams.get('address')).toBe(acc.evmAddress)
    expect(new URL(nonceUrl, 'https://x').searchParams.get('surface')).toBe('web')
    expect(calls.find((c) => c.m === 'signLogin')!.a).toBe('Sign in to 420.meme\nnonce: n1')
    expect(calls.some((c) => c.m === 'signSolanaMessage')).toBe(false)   // 登录不走通用签消息
    const body = verifyBody as unknown as { address: string; chainType: string; signature: Hex; surface?: string }
    expect(body.address).toBe(acc.evmAddress)
    expect(body.chainType).toBe('evm')
    expect(body.surface).toBeUndefined()
    expect(await verifyMessage({ address: acc.evmAddress as Hex, message: 'Sign in to 420.meme\nnonce: n1', signature: body.signature })).toBe(true)
  })
  it('插件回的是 Solana 签名（老版本插件）/ 没有 0x 地址：拒绝登录', async () => {
    const kp = Keypair.generate()
    const { p } = fakeOx4(kp, generatePrivateKey(), { signLogin: async ({ message }: { message: string }) => ({ signature: bs58.encode(edSign(new TextEncoder().encode(message), kp)), chain: 'solana' as const }) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nonce: 'n', issuedAt: 't', message: 'm' }), { status: 200 })))
    const acc = await p.connect()
    await expect(loginWithWallet(extensionSolanaWallet(p, kp.publicKey.toBase58()), acc.evmAddress, null)).rejects.toThrow()
    await expect(loginWithWallet(extensionSolanaWallet(p, kp.publicKey.toBase58()), null, null)).rejects.toThrow()
  })
})
