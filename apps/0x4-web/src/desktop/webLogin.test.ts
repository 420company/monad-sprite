// @vitest-environment jsdom
// 2026-09-29 goat tested with real Chrome + real extension: the extension kept popping "log in", confirming seemed to do nothing and it popped again; community showed "social service not connected"; perp page showed "you rejected this request".
// Root causes found via e2e reproduction (extension/e2e/web-app.mjs), each guarded here:
//   (1) The extension pushes accountsChanged on every connect/unlock (address unchanged); we used to always detach and re-attach the wallet -> social layer logged out and back in, two login flows = two windows
//   (2) Two concurrent logins: the earlier flow's nonce was invalidated by the later one and returned 401, which was treated as "token expired" - the later flow's fresh token got cleared and login restarted -> popped again
//   (3) Auto-retry 2s after the user hit "Reject" -> popped again; switching back to the tab also retried immediately -> popped again
//   (4) One window for login, another for EVM association
//   (5) Page refresh / extension locked then unlocked: token lived only in memory, had to re-sign
//   (6) Multiple signature requests sent to the extension at once piled up windows; more than 5 per site got auto-rejected; read-only perp queries auto-authorized when unauthorized (popup)
//      (after the 2026-09-29 review, read-only queries are delegated to the extension's perpRead; the web app no longer fetches a proxy signature)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Ox4Provider, Ox4Event } from '@/lib/vault/extension'

vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))
// These cases test login itself; "agree to terms first" (2026-10-02, lib/safety.ts) is covered by safety.test.ts, assumed agreed here
vi.mock('@/lib/safety', async (orig) => ({ ...(await orig<typeof import('@/lib/safety')>()), termsAccepted: () => true }))

const { connectOx4, needSocialLogin, restoreOx4 } = await import('./walletGate')
const { useWallet } = await import('@/store/wallet')
const { useSocial, forgetWebSession } = await import('@/store/social')
const { setToken, getToken, api } = await import('@/lib/social')
const { resetOx4Queue, extensionEvmAccount } = await import('@/lib/vault/extension')
const { loadAccount, placeOrder } = await import('@/lib/aster')

class NoSocket { readyState = 0; onopen = null; onclose = null; onmessage = null; send() {} close() {} }

function fakeOx4() {
  const kp = Keypair.generate()
  const evm = privateKeyToAccount(generatePrivateKey())
  const calls: { m: string; a?: unknown }[] = []
  const handlers: Partial<Record<Ox4Event, ((x?: unknown) => void)[]>> = {}
  const accounts = { address: kp.publicKey.toBase58(), evmAddress: evm.address, btcAddress: '' }
  let loginAnswer: 'ok' | 'reject' = 'ok'
  /** Whether the extension is locked (since 2026-10-06, locking no longer logs the web app out; tests must be able to simulate locked) */
  const lock = { unlocked: true }
  const emit = (n: Ox4Event, data?: unknown) => (handlers[n] || []).forEach((cb) => cb(data))
  const p = {
    isOx4: true,
    status: async () => ({ version: '1', connected: true, unlocked: lock.unlocked, ...accounts }),
    // Like the real extension: push accountsChanged once before connect returns (address unchanged); when locked, unlock first inside the connect window
    connect: async () => { calls.push({ m: 'connect' }); lock.unlocked = true; emit('accountsChanged', accounts); return accounts },
    // Since 2026-09-30 the web app logs in with the 0x address: the extension signs the server-issued SIWE with the EVM key
    signLogin: async ({ message, evmLink }: { message: string; evmLink?: string }) => {
      calls.push({ m: 'signLogin', a: { message, evmLink } })
      if (loginAnswer === 'reject') throw { code: 4001, message: '你拒绝了这个请求' }
      return { signature: await evm.signMessage({ message }), chain: 'evm' }
    },
    signEvmMessage: async ({ message }: { message: string }) => { calls.push({ m: 'signEvmMessage', a: message }); return { signature: await evm.signMessage({ message }) } },
    signEvmTypedData: async () => { calls.push({ m: 'signEvmTypedData' }); return { signature: '0x' + '11'.repeat(65) } },
    agentAddress: async () => ({ address: '0x000000000000000000000000000000000000a9e7' }),
    signAgentTypedData: async ({ typedData }: { typedData: string }) => { calls.push({ m: 'signAgentTypedData', a: typedData }); return { signature: '0x' + '22'.repeat(65) } },
    // Perp read-only queries: the real extension signs and requests the exchange itself; here the (test-stubbed) fetch simulates the extension-side request, handing back only status code and JSON
    perpRead: async ({ endpoint, params }: { endpoint: string; params?: Record<string, string> }) => {
      calls.push({ m: 'perpRead', a: { endpoint, params } })
      const r = await fetch(`https://fapi.asterdex.com/fapi/v3/${endpoint}?from=plugin`)
      return { status: r.status, body: JSON.parse(await r.text()) }
    },
    dmPublicKey: async () => { calls.push({ m: 'dmPublicKey' }); return { publicKey: 'PUB' } },
    on: (n: Ox4Event, cb: (x?: unknown) => void) => { (handlers[n] ||= []).push(cb) },
    off: () => {},
  } as unknown as Ox4Provider
  return { p, calls, accounts, emit, lock, setLogin: (a: 'ok' | 'reject') => { loginAnswer = a } }
}

/** Local fake server: issues a fresh nonce each time, only honors the latest one (like the real server), and counts calls per endpoint */
function fakeServer(address: () => string) {
  const hits: string[] = []
  let nonce = 0
  let current = ''
  const tokens = new Set<string>()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    hits.push(`${init?.method || 'GET'} ${path}`)
    const auth = String((init?.headers as Record<string, string> | undefined)?.authorization || '')
    const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
    if (path === '/api/auth/nonce') { current = `n${++nonce}`; return j({ nonce: current, issuedAt: 't', message: `login ${current}` }) }
    if (path === '/api/auth/verify') {
      const b = JSON.parse(String(init?.body))
      if (!b.signature || !b.issuedAt || nonce === 0) return j({ error: '签名无效或已过期' }, 401)
      const tk = `T${nonce}`; tokens.add(tk)
      return j({ token: tk, user: { address: address(), nickname: 'User100', encPub: 'PUB', evmVerified: b.chainType === 'evm' } })
    }
    if (path === '/api/me' && (init?.method || 'GET') === 'GET') {
      return tokens.has(auth.replace('Bearer ', '')) ? j({ address: address(), nickname: 'User100', encPub: 'PUB', evmVerified: true }) : j({ error: '未登录' }, 401)
    }
    if (path === '/api/auth/refresh') return tokens.has(auth.replace('Bearer ', '')) ? j({ token: auth.replace('Bearer ', '') }) : j({ error: '未登录' }, 401)
    return j(path.endsWith('s') || path.includes('groups') ? [] : {})
  }))
  return { hits, count: (s: string) => hits.filter((h) => h === s).length, revokeAll: () => tokens.clear(), addToken: (tk: string) => tokens.add(tk) }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoSocket)
  localStorage.clear()
  resetOx4Queue()
  useSocial.getState().logout()
  useWallet.getState().detachExtension()
  setToken(null)
})
afterEach(() => { delete (window as unknown as { ox4?: unknown }).ox4; vi.unstubAllGlobals(); vi.useRealTimers() })

/** The effect in App.tsx: log in when the wallet attaches, log out when it detaches (web) */
function wireApp() {
  return useWallet.subscribe((cur, prev) => {
    if (cur.wallet === prev.wallet) return
    if (cur.wallet) void useSocial.getState().login(); else useSocial.getState().logout()
  })
}

describe('网页版登录只弹一次', () => {
  it('连接：插件推「地址没变」的 accountsChanged 不再摘钱包；只签一次登录（0x 地址 + SIWE，不再另签 EVM 关联）', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off()
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    expect(srv.count('GET /api/auth/nonce')).toBe(1)
    expect(srv.count('POST /api/auth/verify')).toBe(1)
    // Since 2026-09-30: web logs in with the extension's 0x address (nonce request carries the 0x address); the login itself proves the 0x address, so no EVM association message is attached
    const login = f.calls.find((c) => c.m === 'signLogin')!.a as { evmLink?: string }
    expect(login.evmLink).toBeUndefined()
    expect(f.calls.some((c) => c.m === 'signEvmMessage')).toBe(false)
    const calls = vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]
    expect(new URL(calls.find(([u]) => String(u).includes('/api/auth/nonce'))![0], 'https://x').searchParams.get('address')).toBe(f.accounts.evmAddress)
    const vb = JSON.parse(String(calls.find(([u]) => String(u).includes('/api/auth/verify'))![1].body))
    expect(vb).toMatchObject({ address: f.accounts.evmAddress, chainType: 'evm' })
    expect(vb.evmSignature).toBeUndefined()
    expect(useSocial.getState().me?.evmVerified).toBe(true)
  })

  // 2026-09-30: a 0x login may land in the mobile app's account, whose registered DM key differs from the extension's -> don't overwrite (overwriting would break new-DM reading in the app), flag dmKeyElsewhere
  it('登进的账号登记着另一把私信钥匙：不改账号的钥匙（不发 PUT /api/me），提示去手机上看私信；钥匙相同时照常', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => 'AppSo1anaAccount1111111111111111111111111')
    const real = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const r = await real(url as string, init)
      if (String(url).includes('/api/auth/verify') && r.status === 200) { const b = await r.json(); return new Response(JSON.stringify({ ...b, user: { ...b.user, encPub: 'APP-KEY' } }), { status: 200 }) }
      return r
    })
    const off = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off()
    expect(srv.count('PUT /api/me')).toBe(0)
    expect(useSocial.getState().dmKeyElsewhere).toBe(true)
    expect(useSocial.getState().me?.encPub).toBe('APP-KEY')
    // Positive control: keys identical (extension and app share the same seed phrase) -> no prompt
    useSocial.getState().logout(true); useWallet.getState().detachExtension(); resetOx4Queue()
    vi.mocked(fetch).mockImplementation(real)
    const off2 = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off2()
    expect(useSocial.getState().dmKeyElsewhere).toBe(false)
  })

  it('阳性对照：地址真的变了（插件里换号）照样重新挂上、给新地址登录', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    fakeServer(() => useWallet.getState().address || '')
    await connectOx4()
    const before = useWallet.getState().wallet
    f.emit('accountsChanged', { ...f.accounts })   // unchanged
    expect(useWallet.getState().wallet).toBe(before)
    f.emit('accountsChanged', { ...f.accounts, address: Keypair.generate().publicKey.toBase58() })   // changed
    expect(useWallet.getState().wallet).not.toBe(before)
  })

  it('摘下再挂上同一个地址（插件锁定又解锁）正在登录的那一趟接着用，不再签第二次', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    // While login is still in flight: detach, then re-attach immediately
    useWallet.getState().detachExtension()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off()
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
  })

  it('用户拒绝登录：停在 error 写明原因，之后不自动再弹（等 40 秒、切回标签页都不弹）；用户做要登录的操作时才再请求一次', async () => {
    const f = fakeOx4()
    f.setLogin('reject')
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('error'))
    expect(useSocial.getState().error).toMatch(/取消了登录/)
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(40_000)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(5_000)
    vi.useRealTimers()
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    // Background write requests the page fires itself (no user action): block them, but don't pop a login
    f.setLogin('ok')
    const bg = await api('/api/dms/ack', { method: 'POST', body: '{}' }).catch((x) => x)
    expect((bg as Error).name).toBe('WalletRequired')
    await new Promise((r) => setTimeout(r, 30))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    // User tapped post (browser "user activation" still present): request login first, don't fire this request
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { userActivation: { isActive: true } }))
    const e = await api('/api/posts', { method: 'POST', body: '{}' }).catch((x) => x)
    expect((e as Error).name).toBe('WalletRequired')
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(2)
    expect(needSocialLogin()).toBe(false)
    off()
  })

  it('令牌按地址存在本机：刷新页面（内存清空）不用再签；断开钱包就删掉', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    // "Page refresh": in-memory token and wallet are gone
    useWallet.getState().detachExtension()
    setToken(null)
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    expect(srv.count('GET /api/me')).toBeGreaterThanOrEqual(1)
    // Server says the token is revoked: clear it, re-sign this time (connecting counts as a user action)
    useWallet.getState().detachExtension()
    setToken(null)
    srv.revokeAll()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(2)
    forgetWebSession()
    expect(localStorage.getItem('0x4.webSession')).toBeNull()
    off()
  })

  // 2026-09-29 security review: web tokens live in browser local storage (reachable by same-origin scripts), so delete them when the extension locks/disconnects;
  // Log in by signing the web template (the server marks the token as web-only from this, and it can't approve QR-code logins); previously stored tokens without the web mark are no longer used
  it('插件锁定：登录和令牌都留着，解锁后不再签（2026-10-06 起）；插件断开才删令牌；取网页版登录模板（nonce 带 surface=web）；旧格式存的令牌不用', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    const off = wireApp()
    // Old format (no v: 3: stored before 2026-09-29, or stored by extension-Solana-address logins before 2026-09-30): don't use it, sign in directly (don't query /api/me with it first)
    localStorage.setItem('0x4.webSession', JSON.stringify({ address: f.accounts.address, token: 'OLD' }))
    localStorage.setItem('0x4.webSession', JSON.stringify({ address: f.accounts.address, token: 'OLD', v: 2 }))
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(srv.count('GET /api/me')).toBe(0)
    // Web needs the web login template (nonce carries surface=web; the server marks the token web from the signed template); the verify body no longer carries surface (the server ignores it anyway)
    const calls = vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]
    const nonceUrl = new URL(calls.find(([u]) => String(u).includes('/api/auth/nonce'))![0], 'https://x')
    expect(nonceUrl.searchParams.get('surface')).toBe('web')
    const verify = calls.find(([u]) => String(u).includes('/api/auth/verify'))!
    expect(JSON.parse(String(verify[1].body)).surface).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('0x4.webSession')!)).toMatchObject({ address: f.accounts.address, v: 3 })
    // Extension locked: keep login, token and wallet (2026-10-06 goat: "woke up and had to log in again"); no re-sign after unlock either
    f.lock.unlocked = false
    f.emit('lock')
    expect(localStorage.getItem('0x4.webSession')).not.toBeNull()
    expect(useWallet.getState().wallet).not.toBeNull()
    expect(useSocial.getState().status).toBe('ready')
    f.lock.unlocked = true
    f.emit('accountsChanged', f.accounts)
    await new Promise((r) => setTimeout(r, 20))
    expect(useSocial.getState().status).toBe('ready')
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    // Disconnecting this site in the extension: delete them too
    f.emit('disconnect')
    expect(localStorage.getItem('0x4.webSession')).toBeNull()
    off()
  })

  // 2026-09-29 review suggestion 8: web tokens were 24h then (7 days since 10/06); they used to renew only once on page open, so a tab open past 24h got logged out
  it('标签页一直开着：每 6 小时续一次令牌、切回标签页（距上次超过 10 分钟）也续；续期被拒（到续期上限）才提示登录过期；全程不弹签名', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    const refreshes = () => srv.count('POST /api/auth/refresh')
    expect(refreshes()).toBe(0)   // A freshly signed-in token doesn't need an immediate renewal
    // Switching back to the tab: less than 10 minutes since last (login), don't renew
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5 * 3600_000)
    expect(refreshes()).toBe(0)
    await vi.advanceTimersByTimeAsync(3600_000 + 16 * 60_000)
    expect(refreshes()).toBe(1)   // Renew once the 6-hour mark hits
    // Open for 30 hours (past the token's 24h): kept renewing, stayed ready
    await vi.advanceTimersByTimeAsync(24 * 3600_000)
    expect(refreshes()).toBe(5)
    expect(useSocial.getState().status).toBe('ready')
    // Switching back to the tab: renew only if more than 10 minutes since the last renewal
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(refreshes()).toBe(6))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(refreshes()).toBe(6)
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    // At the 7-day cap the server refuses renewal (401): stop at "login expired", don't auto-pop a signature, and don't renew afterwards
    srv.revokeAll()
    await vi.advanceTimersByTimeAsync(6 * 3600_000 + 16 * 60_000)
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('error'))
    expect(useSocial.getState().error).toMatch(/过期/)
    const n = refreshes()
    await vi.advanceTimersByTimeAsync(13 * 3600_000)
    expect(refreshes()).toBe(n)
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    off()
    delete (document as unknown as { hidden?: boolean }).hidden
  })

  it('用着的时候令牌过期（401）：不自己弹登录，停在 error「登录已过期」', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    srv.revokeAll()
    await api('/api/me').catch(() => {})
    expect(useSocial.getState().status).toBe('error')
    expect(useSocial.getState().error).toMatch(/过期/)
    await new Promise((r) => setTimeout(r, 50))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    expect(getToken()).toBeNull()
    off()
  })
})

// 2026-09-29 review: loginWithWallet used to set the token globally the moment it arrived, only then checking whether the wallet was still the same one.
// Before A's login finished exchanging the token, the extension switched to B: B logged in first, A's token arrived later, and the global token got swapped to A's - UI shows B while API calls go out as A (posts, DMs, transfer records all recorded under A).
describe('换号时的登录竞态', () => {
  it('A 的登录回复晚于 B 登录完成才回来：全局令牌仍是 B 的，界面和接口身份一致', async () => {
    const kpA = Keypair.generate(), kpB = Keypair.generate()
    const evmA = privateKeyToAccount(generatePrivateKey()), evmB = privateKeyToAccount(generatePrivateKey())
    const accOf = (kp: Keypair) => ({ address: kp.publicKey.toBase58(), evmAddress: (kp === kpA ? evmA : evmB).address, btcAddress: '' })
    let current = kpA
    let releaseA!: () => void
    const heldA = new Promise<void>((r) => { releaseA = r })
    const handlers: Partial<Record<Ox4Event, ((x?: unknown) => void)[]>> = {}
    const p = {
      isOx4: true,
      status: async () => ({ version: '1', connected: true, unlocked: true, ...accOf(current) }),
      connect: async () => accOf(current),
      signLogin: async ({ message }: { message: string }) => {
        const e = message.includes(evmA.address) ? evmA : evmB
        return { signature: await e.signMessage({ message }), chain: 'evm' }
      },
      dmPublicKey: async () => ({ publicKey: 'PUB' }),
      on: (n: Ox4Event, cb: (x?: unknown) => void) => { (handlers[n] ||= []).push(cb) },
      off: () => {},
    } as unknown as Ox4Provider
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = p
    // Fake server: token = T:<address>, /api/me answers identity from the token
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
      const who = String((init?.headers as Record<string, string> | undefined)?.authorization || '').replace('Bearer T:', '')
      if (u.pathname === '/api/auth/nonce') { const a = u.searchParams.get('address')!; return j({ nonce: 'n', issuedAt: 't', message: `login ${a}` }) }
      if (u.pathname === '/api/auth/verify') {
        const b = JSON.parse(String(init?.body))
        // Web 0x login: the request carries the 0x address; the server logs into the matching account from the proof (here A/B's 0x each maps to A/B's Solana account)
        const acct = b.address === evmA.address ? kpA.publicKey.toBase58() : kpB.publicKey.toBase58()
        if (acct === kpA.publicKey.toBase58()) await heldA   // A finished signing, but the token-exchange response is slow on the network
        return j({ token: `T:${acct}`, user: { address: acct, nickname: 'x', encPub: 'PUB' } })
      }
      if (u.pathname === '/api/me') return who ? j({ address: who, nickname: 'x', encPub: 'PUB' }) : j({ error: '未登录' }, 401)
      return j(u.pathname.endsWith('s') || u.pathname.includes('groups') ? [] : {})
    }))
    const off = wireApp()
    await connectOx4()                          // A attached, A signed the login, the token-exchange response still in flight
    await new Promise((r) => setTimeout(r, 20))
    current = kpB
    for (const cb of handlers.accountsChanged || []) cb(accOf(kpB))   // Switched to B in the extension
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(useSocial.getState().me?.address).toBe(kpB.publicKey.toBase58())
    expect(getToken()).toBe(`T:${kpB.publicKey.toBase58()}`)
    releaseA()                                  // A's response only arrives now
    await new Promise((r) => setTimeout(r, 50))
    expect(useWallet.getState().address).toBe(kpB.publicKey.toBase58())
    expect(getToken()).toBe(`T:${kpB.publicKey.toBase58()}`)   // Before the fix this became T:A
    expect(useSocial.getState().me?.address).toBe(kpB.publicKey.toBase58())
    off()
  })
})

describe('插件确认窗口排队', () => {
  it('同时发起的签名一个一个交给插件；用户拒绝一个，那一刻排着的一起取消，之后新的照常', async () => {
    const order: string[] = []
    let release!: () => void
    const first = new Promise<void>((r) => { release = r })
    const p = {
      signEvmMessage: async ({ message }: { message: string }) => {
        order.push(`start ${message}`)
        if (message === 'a') await first
        if (message === 'r') throw { code: 4001, message: '你拒绝了这个请求' }
        order.push(`end ${message}`)
        return { signature: '0x' + '33'.repeat(65) }
      },
    } as unknown as Ox4Provider
    const acc = extensionEvmAccount(p, privateKeyToAccount(generatePrivateKey()).address)
    const a = acc.signMessage!({ message: 'a' })
    const b = acc.signMessage!({ message: 'b' })
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['start a'])   // b is queued; the extension shows only one window at a time
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
    // Reject: those queued behind it (same batch) are cancelled, no more popups
    order.length = 0
    const r = acc.signMessage!({ message: 'r' }).catch((e) => e.code)
    const c = acc.signMessage!({ message: 'c' }).catch((e) => e.code)
    expect(await r).toBe(4001)
    expect(await c).toBe(4001)
    expect(order).toEqual(['start r'])
    // New requests started afterwards behave normally
    await acc.signMessage!({ message: 'd' })
    expect(order).toEqual(['start r', 'start d', 'end d'])
  })
})

describe('合约页只读查询不弹窗', () => {
  it('没授权时只读查询不自动去授权（不调主钱包签名）；用户第一次下单先授权再签单子', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    fakeServer(() => f.accounts.address)
    await connectOx4()
    const account = useWallet.getState().evmAccount!
    const aster: string[] = []
    const base = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('asterdex')) return (base as typeof fetch)(url, init)
      aster.push(`${init?.method || 'GET'} ${String(url).split('?')[0].replace('https://fapi.asterdex.com', '')}`)
      if (String(url).includes('approveAgent')) return new Response('{"code":200,"msg":"success"}', { status: 200 })
      return new Response('{"code":-1000,"msg":"No agent found"}', { status: 400 })
    }))
    await expect(loadAccount(account)).rejects.toThrow('NO_AGENT')
    expect(f.calls.some((c) => c.m === 'signEvmTypedData')).toBe(false)   // No authorization popup
    expect(aster).toEqual(['GET /fapi/v3/account'])
    // Page refreshes 8s later: unauthorized was just confirmed within the last minute, so don't sign and ask the exchange again
    await expect(loadAccount(account)).rejects.toThrow('NO_AGENT')
    expect(aster).toEqual(['GET /fapi/v3/account'])
    // Account lookups are delegated to the extension (perpRead, no popup, no queueing): the web app doesn't fetch a proxy signature (2026-09-29 review: that kind of signature could be reused against write endpoints)
    expect(f.calls.filter((c) => c.m === 'perpRead')).toHaveLength(1)
    expect(f.calls.some((c) => c.m === 'signAgentTypedData')).toBe(false)
    // User places an order: authorize first (one window for the main wallet), then sign the order - never sign an order that's doomed to fail first
    f.calls.length = 0
    const market = { index: 0, coin: 'BTC', symbol: 'BTCUSDT', szDecimals: 3, pxDecimals: 1, maxLeverage: 100, markPx: 60000, prevDayPx: 60000, change24h: 0, funding: 0, volume24h: 0, openInterest: 0, onlyIsolated: false }
    await placeOrder(account, { market, isBuy: true, size: 0.001 }).catch(() => {})
    expect(f.calls[0]?.m).toBe('signEvmTypedData')
    expect(aster[1]).toBe('POST /fapi/v3/approveAgent')
  })
})

// 2026-10-06 goat: "web page left open, woke up and everything wallet-related needed re-login": the extension auto-locks after 15 minutes by default; previously a lock deleted the token and detached the wallet.
// Now the wallet attaches even while the extension is locked and logs in with the stored token; no extension window is popped for login; the DM public key is registered after unlock
describe('插件锁着打开网页', () => {
  const save = (address: string, token: string) => localStorage.setItem('0x4.webSession', JSON.stringify({ address, token, v: 3 }))
  const userClick = (on: boolean) => Object.defineProperty(navigator, 'userActivation', { value: { isActive: on }, configurable: true })
  afterEach(() => { delete (navigator as unknown as { userActivation?: unknown }).userActivation })

  it('存的令牌还有效：直接登录，不弹任何插件窗口、不问插件要私信公钥；插件解锁后才补问公钥', async () => {
    const f = fakeOx4()
    f.lock.unlocked = false
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    srv.addToken('SAVED')
    save(f.accounts.address, 'SAVED')
    const off = wireApp()
    await restoreOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off()
    expect(useWallet.getState().keysUnlocked).toBe(false)
    expect(f.calls.map((c) => c.m)).not.toContain('connect')
    expect(f.calls.map((c) => c.m)).not.toContain('signLogin')
    expect(f.calls.map((c) => c.m)).not.toContain('dmPublicKey')
    expect(srv.count('GET /api/auth/nonce')).toBe(0)
    // User unlocks in the extension popup: the extension pushes accountsChanged (address unchanged) -> clear the lock, request the DM public key once more
    f.lock.unlocked = true
    f.emit('accountsChanged', f.accounts)
    expect(useWallet.getState().keysUnlocked).toBe(true)
    await vi.waitFor(() => expect(f.calls.filter((c) => c.m === 'dmPublicKey')).toHaveLength(1))
    expect(useSocial.getState().status).toBe('ready')
  })

  it('存的令牌过期了：打开网页不弹插件窗口，停在「登录已过期」；用户点了要登录的东西才请插件解锁 + 登录（一次）', async () => {
    const f = fakeOx4()
    f.lock.unlocked = false
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    save(f.accounts.address, 'EXPIRED')
    const off = wireApp()
    await restoreOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('error'))
    expect(useSocial.getState().error).toMatch(/登录已过期|sign-in has expired/)
    expect(f.calls.map((c) => c.m)).not.toContain('connect')
    expect(f.calls.map((c) => c.m)).not.toContain('signLogin')
    expect(srv.count('GET /api/auth/nonce')).toBe(0)
    // User tapped something that requires login
    userClick(true)
    expect(needSocialLogin()).toBe(true)
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off()
    expect(f.calls.filter((c) => c.m === 'connect')).toHaveLength(1)
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
  })

  it('对照：插件没锁、令牌过期：打开网页照旧直接签一次登录（和以前一样）', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    fakeServer(() => f.accounts.address)
    save(f.accounts.address, 'EXPIRED')
    const off = wireApp()
    await restoreOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    off()
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
  })
})
