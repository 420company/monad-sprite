// @vitest-environment jsdom
// Agree to the terms before creating / logging into an account (2026-10-02 goat, store requirement; lib/safety.ts + store/social.ts's login()).
// Coverage: without agreement, no login request to the server, no signature popup — show the terms; tapping "later" suppresses auto-popup for this session; agreement proceeds to normal login;
//      after account deletion the agreement record is cleared (no auto-created new account); a terms version bump requires re-agreement; agreement is recorded per wallet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Ox4Provider, Ox4Event } from '@/lib/vault/extension'

vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))

const { connectOx4 } = await import('./walletGate')
const { useWallet } = await import('@/store/wallet')
const { useSocial, walletKey } = await import('@/store/social')
const { setToken } = await import('@/lib/social')
const { resetOx4Queue } = await import('@/lib/vault/extension')
const { TERMS_VERSION, acceptTerms, revokeTerms, termsAccepted, useTermsGate } = await import('@/lib/safety')

class NoSocket { readyState = 0; onopen = null; onclose = null; onmessage = null; send() {} close() {} }

function fakeOx4() {
  const kp = Keypair.generate()
  const evm = privateKeyToAccount(generatePrivateKey())
  const signs: string[] = []
  const handlers: Partial<Record<Ox4Event, ((x?: unknown) => void)[]>> = {}
  const accounts = { address: kp.publicKey.toBase58(), evmAddress: evm.address, btcAddress: '' }
  const p = {
    isOx4: true,
    status: async () => ({ version: '1', connected: true, unlocked: true, ...accounts }),
    connect: async () => { (handlers.accountsChanged || []).forEach((cb) => cb(accounts)); return accounts },
    signLogin: async ({ message }: { message: string }) => { signs.push(message); return { signature: await evm.signMessage({ message }), chain: 'evm' } },
    agentAddress: async () => ({ address: '0x000000000000000000000000000000000000a9e7' }),
    dmPublicKey: async () => ({ publicKey: 'PUB' }),
    on: (n: Ox4Event, cb: (x?: unknown) => void) => { (handlers[n] ||= []).push(cb) },
    off: () => {},
  } as unknown as Ox4Provider
  return { p, signs, accounts }
}
function fakeServer(address: () => string) {
  const hits: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    hits.push(`${init?.method || 'GET'} ${path}`)
    const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
    if (path === '/api/auth/nonce') return j({ nonce: 'n1', issuedAt: 't', message: 'login n1' })
    if (path === '/api/auth/verify') return j({ token: 'T1', user: { address: address(), nickname: 'User100', encPub: 'PUB', evmVerified: true } })
    if (path === '/api/me') return j({ address: address(), nickname: 'User100', encPub: 'PUB', evmVerified: true })
    return j(path.endsWith('s') || path.includes('groups') ? [] : {})
  }))
  return { hits, count: (s: string) => hits.filter((h) => h === s).length }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoSocket)
  localStorage.clear()
  resetOx4Queue()
  useSocial.getState().logout()
  useWallet.getState().detachExtension()
  useTermsGate.setState({ open: false, dismissed: false })
  setToken(null)
})
afterEach(() => { delete (window as unknown as { ox4?: unknown }).ox4; vi.unstubAllGlobals() })

describe('先同意条款才登录', () => {
  it('同意记录按钱包、按条款版本记在本机', () => {
    expect(termsAccepted('A')).toBe(false); expect(termsAccepted(null)).toBe(false)
    acceptTerms('A')
    expect(termsAccepted('A')).toBe(true); expect(termsAccepted('B')).toBe(false)
    // Terms version bumped (device remembers the old one): re-agreement required
    localStorage.setItem('0x4.terms', JSON.stringify({ A: TERMS_VERSION - 1 }))
    expect(termsAccepted('A')).toBe(false)
    acceptTerms('A'); revokeTerms('A')
    expect(termsAccepted('A')).toBe(false)
    // Corrupted local storage: treat as never agreed, no error
    localStorage.setItem('0x4.terms', '{坏的')
    expect(termsAccepted('A')).toBe(false)
  })

  it('没同意：连上钱包也不登录、不弹签名，弹出条款；同意后照常登录', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    await connectOx4()
    await useSocial.getState().login()
    expect(useSocial.getState().status).toBe('idle')
    expect(srv.count('GET /api/auth/nonce')).toBe(0)
    expect(f.signs).toHaveLength(0)
    expect(useTermsGate.getState().open).toBe(true)
    // "Later": no more auto-popups this session (login still doesn't proceed); manually tapping still shows it
    useTermsGate.getState().hide(true)
    await useSocial.getState().login()
    expect(useTermsGate.getState().open).toBe(false)
    expect(srv.count('GET /api/auth/nonce')).toBe(0)
    useTermsGate.getState().show(true)
    expect(useTermsGate.getState().open).toBe(true)
    // Agree: record it, login completes as usual
    acceptTerms(walletKey()!)
    useTermsGate.getState().hide()
    await useSocial.getState().login()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(f.signs).toHaveLength(1)
    expect(srv.count('POST /api/auth/verify')).toBe(1)
  })

  it('注销账号以后：同意记录清掉，不会自动又建一个新账号', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    await connectOx4()
    acceptTerms(walletKey()!)
    await useSocial.getState().login()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    // The three things done after successful on-screen deletion (components/AccountDeleteSheet.tsx)
    revokeTerms(walletKey()!)
    useTermsGate.setState({ open: false, dismissed: true })
    useSocial.getState().logout(true)
    const before = srv.count('GET /api/auth/nonce')
    await useSocial.getState().login()
    expect(useSocial.getState().status).toBe('idle')
    expect(srv.count('GET /api/auth/nonce')).toBe(before)
    expect(useTermsGate.getState().open).toBe(false)
    // The wallet stays connected (deletion removes the account, not the wallet)
    expect(walletKey()).toBe(f.accounts.address)
  })
})
