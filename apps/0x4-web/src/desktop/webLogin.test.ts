// @vitest-environment jsdom
// 2026-09-29 goat 用真 Chrome + 真插件实测：插件一直弹「登录」、点了确认好像没用又弹；社区「社交服务未连接」；合约页「你拒绝了这个请求」。
// 端到端复现（extension/e2e/web-app.mjs）找到的根因，这里逐条守着：
//   ① 插件每次 connect / 解锁都推 accountsChanged（地址没变），以前一律摘掉钱包再挂上 → 社交层登出又登录，两趟登录两个窗口
//   ② 两趟登录并发：前一趟的 nonce 被后一趟作废回 401，被当成「令牌过期」清掉后一趟刚拿到的令牌再登 → 又弹
//   ③ 用户点「拒绝」后 2 秒自动重试 → 又弹；切回标签页也会立刻重试 → 又弹
//   ④ 登录一个窗口、EVM 关联又一个窗口
//   ⑤ 刷新页面 / 插件锁了又解锁：令牌只在内存里，要重新签
//   ⑥ 多个签名同时发给插件，窗口叠一堆，超过每站 5 个被自动拒；合约页只读查询没授权时自动去授权（弹窗）
//      （只读查询 2026-09-29 审查后改由插件 perpRead 代办，网页不再拿代理签名）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Ox4Provider, Ox4Event } from '@/lib/vault/extension'

vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))
// 这些用例测的是登录本身；「先同意条款」（2026-10-02，lib/safety.ts）另有 safety.test.ts 测，这里一律当已同意
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
  /** 插件锁没锁（2026-10-06 起插件锁了网页不登出，测试要能模拟锁着） */
  const lock = { unlocked: true }
  const emit = (n: Ox4Event, data?: unknown) => (handlers[n] || []).forEach((cb) => cb(data))
  const p = {
    isOx4: true,
    status: async () => ({ version: '1', connected: true, unlocked: lock.unlocked, ...accounts }),
    // 和真插件一样：connect 返回前推一次 accountsChanged（地址没变）；锁着时 connect 弹的窗口里先解锁
    connect: async () => { calls.push({ m: 'connect' }); lock.unlocked = true; emit('accountsChanged', accounts); return accounts },
    // 2026-09-30 起网页版用 0x 地址登录：插件用 EVM 私钥签服务器给的 SIWE
    signLogin: async ({ message, evmLink }: { message: string; evmLink?: string }) => {
      calls.push({ m: 'signLogin', a: { message, evmLink } })
      if (loginAnswer === 'reject') throw { code: 4001, message: '你拒绝了这个请求' }
      return { signature: await evm.signMessage({ message }), chain: 'evm' }
    },
    signEvmMessage: async ({ message }: { message: string }) => { calls.push({ m: 'signEvmMessage', a: message }); return { signature: await evm.signMessage({ message }) } },
    signEvmTypedData: async () => { calls.push({ m: 'signEvmTypedData' }); return { signature: '0x' + '11'.repeat(65) } },
    agentAddress: async () => ({ address: '0x000000000000000000000000000000000000a9e7' }),
    signAgentTypedData: async ({ typedData }: { typedData: string }) => { calls.push({ m: 'signAgentTypedData', a: typedData }); return { signature: '0x' + '22'.repeat(65) } },
    // 合约只读查询：真插件自己签名、自己请求交易所，这里用（被测试替换过的）fetch 模拟插件那一侧的请求，只把状态码和 JSON 交回
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

/** 本机假服务器：nonce 每次新发一个、只认最新那个（和真服务器一样），记下每个接口被调了几次 */
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

/** App.tsx 的那条 effect：钱包挂上就登录、摘掉就登出（网页版） */
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
    // 2026-09-30 起：网页版用插件的 0x 地址登录（nonce 请求带 0x 地址），登录本身就证明了 0x 地址，不再附带 EVM 关联消息
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

  // 2026-09-30：0x 登录可能登进手机 App 的账号，那边登记的私信钥匙和插件的不是同一把 → 不覆盖（覆盖了 App 就读不了新私信），标记 dmKeyElsewhere
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
    // 阳性对照：钥匙相同（插件和 App 是同一套助记词）→ 不提示
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
    f.emit('accountsChanged', { ...f.accounts })   // 没变
    expect(useWallet.getState().wallet).toBe(before)
    f.emit('accountsChanged', { ...f.accounts, address: Keypair.generate().publicKey.toBase58() })   // 变了
    expect(useWallet.getState().wallet).not.toBe(before)
  })

  it('摘下再挂上同一个地址（插件锁定又解锁）正在登录的那一趟接着用，不再签第二次', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    fakeServer(() => f.accounts.address)
    const off = wireApp()
    await connectOx4()
    // 登录还在路上时：摘掉、马上又挂上
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
    // 页面自己在后台发的写请求（没有用户操作）：拦下，但不弹登录
    f.setLogin('ok')
    const bg = await api('/api/dms/ack', { method: 'POST', body: '{}' }).catch((x) => x)
    expect((bg as Error).name).toBe('WalletRequired')
    await new Promise((r) => setTimeout(r, 30))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    // 用户点了发帖（浏览器「用户激活」还在）：先请求登录，这次请求不发
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
    // 「刷新页面」：内存里的令牌和钱包都没了
    useWallet.getState().detachExtension()
    setToken(null)
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    expect(srv.count('GET /api/me')).toBeGreaterThanOrEqual(1)
    // 服务器说令牌作废了：清掉，这次要重新签（连接是用户操作）
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

  // 2026-09-29 安全审查：网页版令牌存在浏览器本地存储里（同源脚本拿得到），插件锁定 / 断开时一起删；
  // 登录签网页版模板（服务器据此给令牌带网页标记，不能批准扫码登录）；之前存的、没有网页标记的令牌不再用
  it('插件锁定：登录和令牌都留着，解锁后不再签（2026-10-06 起）；插件断开才删令牌；取网页版登录模板（nonce 带 surface=web）；旧格式存的令牌不用', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    const srv = fakeServer(() => f.accounts.address)
    const off = wireApp()
    // 旧格式（没有 v: 3：2026-09-29 以前存的、或 2026-09-30 以前用插件 Solana 地址登录存的）：不拿来用，直接签名登录（不先用它问 /api/me）
    localStorage.setItem('0x4.webSession', JSON.stringify({ address: f.accounts.address, token: 'OLD' }))
    localStorage.setItem('0x4.webSession', JSON.stringify({ address: f.accounts.address, token: 'OLD', v: 2 }))
    await connectOx4()
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(srv.count('GET /api/me')).toBe(0)
    // 网页版要网页版登录模板（nonce 带 surface=web，服务器按签的模板决定令牌是网页版）；verify 请求体不再带 surface（服务器也不看）
    const calls = vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]
    const nonceUrl = new URL(calls.find(([u]) => String(u).includes('/api/auth/nonce'))![0], 'https://x')
    expect(nonceUrl.searchParams.get('surface')).toBe('web')
    const verify = calls.find(([u]) => String(u).includes('/api/auth/verify'))!
    expect(JSON.parse(String(verify[1].body)).surface).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('0x4.webSession')!)).toMatchObject({ address: f.accounts.address, v: 3 })
    // 插件锁定：登录、令牌、钱包都留着（2026-10-06 goat「睡一觉起来要重新登录」）；解锁后也不再签登录
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
    // 插件里断开这个网站：同样删掉
    f.emit('disconnect')
    expect(localStorage.getItem('0x4.webSession')).toBeNull()
    off()
  })

  // 2026-09-29 复审建议 8：网页版令牌当时 24 小时（10/06 起 7 天），以前只在打开页面时续一次，标签页开着超过 24 小时就被登出
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
    expect(refreshes()).toBe(0)   // 刚签名登录拿到的新令牌不用马上续
    // 切回标签页：距上次（登录）不到 10 分钟，不续
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5 * 3600_000)
    expect(refreshes()).toBe(0)
    await vi.advanceTimersByTimeAsync(3600_000 + 16 * 60_000)
    expect(refreshes()).toBe(1)   // 6 小时到了续一次
    // 开着 30 小时（超过令牌的 24 小时）：一直在续，状态一直是 ready
    await vi.advanceTimersByTimeAsync(24 * 3600_000)
    expect(refreshes()).toBe(5)
    expect(useSocial.getState().status).toBe('ready')
    // 切回标签页：距上次续期超过 10 分钟就续一次，不到就不续
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(refreshes()).toBe(6))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(refreshes()).toBe(6)
    expect(f.calls.filter((c) => c.m === 'signLogin')).toHaveLength(1)
    // 到了 7 天上限服务器拒绝续期（401）：停在「登录已过期」，不自己弹签名，之后也不再续
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

// 2026-09-29 审查：loginWithWallet 以前一拿到令牌就设成全局令牌，之后才看钱包是不是还是原来那个。
// A 的登录还没换到令牌就在插件里换成 B：B 先登录好，A 的令牌后回来，全局令牌被换成 A 的——界面显示 B，接口按 A 的身份发（发帖、私信、转账记录都记到 A）。
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
    // 假服务器：令牌 = T:<地址>，/api/me 按令牌回是谁
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
      const who = String((init?.headers as Record<string, string> | undefined)?.authorization || '').replace('Bearer T:', '')
      if (u.pathname === '/api/auth/nonce') { const a = u.searchParams.get('address')!; return j({ nonce: 'n', issuedAt: 't', message: `login ${a}` }) }
      if (u.pathname === '/api/auth/verify') {
        const b = JSON.parse(String(init?.body))
        // 网页版 0x 登录：请求里是 0x 地址，服务器按证明登进对应账号（这里 A / B 的 0x 各自对应 A / B 的 Solana 账号）
        const acct = b.address === evmA.address ? kpA.publicKey.toBase58() : kpB.publicKey.toBase58()
        if (acct === kpA.publicKey.toBase58()) await heldA   // A 签完了，但换令牌的回复在网络上慢了
        return j({ token: `T:${acct}`, user: { address: acct, nickname: 'x', encPub: 'PUB' } })
      }
      if (u.pathname === '/api/me') return who ? j({ address: who, nickname: 'x', encPub: 'PUB' }) : j({ error: '未登录' }, 401)
      return j(u.pathname.endsWith('s') || u.pathname.includes('groups') ? [] : {})
    }))
    const off = wireApp()
    await connectOx4()                          // 挂上 A，A 签了登录，换令牌的回复还在路上
    await new Promise((r) => setTimeout(r, 20))
    current = kpB
    for (const cb of handlers.accountsChanged || []) cb(accOf(kpB))   // 插件里换成 B
    await vi.waitFor(() => expect(useSocial.getState().status).toBe('ready'))
    expect(useSocial.getState().me?.address).toBe(kpB.publicKey.toBase58())
    expect(getToken()).toBe(`T:${kpB.publicKey.toBase58()}`)
    releaseA()                                  // A 的回复这才到
    await new Promise((r) => setTimeout(r, 50))
    expect(useWallet.getState().address).toBe(kpB.publicKey.toBase58())
    expect(getToken()).toBe(`T:${kpB.publicKey.toBase58()}`)   // 修复前这里变成 T:A
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
    expect(order).toEqual(['start a'])   // b 在排队，插件同时只有一个窗口
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
    // 拒绝：排在它后面的（同一批）取消，不再弹
    order.length = 0
    const r = acc.signMessage!({ message: 'r' }).catch((e) => e.code)
    const c = acc.signMessage!({ message: 'c' }).catch((e) => e.code)
    expect(await r).toBe(4001)
    expect(await c).toBe(4001)
    expect(order).toEqual(['start r'])
    // 之后新发起的照常
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
    expect(f.calls.some((c) => c.m === 'signEvmTypedData')).toBe(false)   // 没弹授权
    expect(aster).toEqual(['GET /fapi/v3/account'])
    // 8 秒后页面再刷新：一分钟内刚确认过没授权，不再签名去问交易所
    await expect(loadAccount(account)).rejects.toThrow('NO_AGENT')
    expect(aster).toEqual(['GET /fapi/v3/account'])
    // 查账户交给插件代办（perpRead，不弹窗、不排队）：网页不拿代理签名（2026-09-29 审查：那种签名能拿去调写接口）
    expect(f.calls.filter((c) => c.m === 'perpRead')).toHaveLength(1)
    expect(f.calls.some((c) => c.m === 'signAgentTypedData')).toBe(false)
    // 用户下单：先授权（主钱包一个窗口），再签单子，不先签一个注定失败的单子
    f.calls.length = 0
    const market = { index: 0, coin: 'BTC', symbol: 'BTCUSDT', szDecimals: 3, pxDecimals: 1, maxLeverage: 100, markPx: 60000, prevDayPx: 60000, change24h: 0, funding: 0, volume24h: 0, openInterest: 0, onlyIsolated: false }
    await placeOrder(account, { market, isBuy: true, size: 0.001 }).catch(() => {})
    expect(f.calls[0]?.m).toBe('signEvmTypedData')
    expect(aster[1]).toBe('POST /fapi/v3/approveAgent')
  })
})

// 2026-10-06 goat「网页没关，睡一觉起来钱包那些就要重新登录」：插件默认 15 分钟自动锁，以前一锁网页就删令牌、摘钱包。
// 现在插件锁着也照样挂上钱包、用存的令牌登录；不为登录弹插件窗口；解锁后补登记私信公钥
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
    // 用户在插件弹窗里解锁：插件推 accountsChanged（地址没变）→ 去掉锁、补问一次私信公钥
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
    // 用户点了要登录的东西
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
