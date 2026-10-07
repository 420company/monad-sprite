// @vitest-environment jsdom
// 网页版连 0x4 浏览器插件的整条流程（desktop/walletGate.ts）：没装弹说明、装了就连并挂上签名器、
// 签名前过闸（锁了请插件解锁）、锁定只标锁着 / 断开清掉、打开网页自动恢复（锁着也恢复）、合约交易密钥走插件、没连钱包时社交写操作被拦。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Ox4Provider, Ox4Event } from '@/lib/vault/extension'

// 这些测试模拟网页版（VITE_SURFACE=web）
vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))

const { connectOx4, needWallet, restoreOx4, unlockOx4, useWalletGate } = await import('./walletGate')
const { ensureUnlocked } = await import('@/lib/vault/gate')
const { decodeDm } = await import('@/lib/chatHistory')
const { useWallet } = await import('@/store/wallet')
const { api } = await import('@/lib/social')
const { agentFor, loadAccount, loadFills, loadOpenOrders, loadLeverageBrackets } = await import('@/lib/aster')

/** 假插件 perpRead 的回复（按接口名）；测试里可以换 */
let perpReply: (endpoint: string) => Promise<{ status: number; body: unknown }> = async (endpoint) => ({
  status: 200,
  body: endpoint === 'account' ? { totalMarginBalance: '12.5', maxWithdrawAmount: '3', totalInitialMargin: '1', positions: [] }
    : endpoint === 'leverageBracket' ? [{ symbol: 'BTCUSDT', brackets: [{ initialLeverage: 125 }] }]
    : endpoint === 'userTrades' ? [{ id: 1, symbol: 'BTCUSDT', side: 'BUY', price: '100', qty: '0.1', time: 1, realizedPnl: '0', commission: '0.01' }]
    : [],
})

function fakeOx4(state = { connected: true, unlocked: true }) {
  const kp = Keypair.generate()
  const evm = privateKeyToAccount(generatePrivateKey())
  const calls: string[] = []
  const handlers: Partial<Record<Ox4Event, ((x?: unknown) => void)[]>> = {}
  const accounts = { address: kp.publicKey.toBase58(), evmAddress: evm.address, btcAddress: 'bc1qtest' }
  const p = {
    isOx4: true,
    status: async () => { calls.push('status'); return { version: '1', ...state, ...(state.connected ? accounts : { address: '', evmAddress: '', btcAddress: '' }) } },
    connect: async () => { calls.push('connect'); state.connected = true; state.unlocked = true; return accounts },
    signSolanaMessage: async () => { calls.push('signSolanaMessage'); return { signature: '1'.repeat(88) } },
    signLogin: async () => { calls.push('signLogin'); return { signature: 'S', chain: 'solana' } },
    agentAddress: async () => { calls.push('agentAddress'); return { address: '0x000000000000000000000000000000000000a9e7' } },
    signAgentTypedData: async () => { calls.push('signAgentTypedData'); return { signature: '0xa' } },
    perpRead: async (o: { endpoint: string; params?: Record<string, string> }) => { calls.push(`perpRead:${o.endpoint}:${JSON.stringify(o.params || {})}`); return perpReply(o.endpoint) },
    signEvmMessage: async () => { calls.push('signEvmMessage'); return { signature: '0x' } },
    dmDecrypt: async () => { calls.push('dmDecrypt'); return { text: '你好' } },
    on: (n: Ox4Event, cb: (x?: unknown) => void) => { (handlers[n] ||= []).push(cb) },
    off: () => {},
  } as unknown as Ox4Provider
  const emit = (n: Ox4Event, data?: unknown) => (handlers[n] || []).forEach((cb) => cb(data))
  return { p, calls, accounts, state, emit }
}

beforeEach(() => { useWallet.getState().detachExtension(); useWalletGate.setState({ open: false, getOx4: false, connecting: false }) })
afterEach(() => { delete (window as unknown as { ox4?: unknown }).ox4; vi.unstubAllGlobals() })

describe('连接 0x4 Wallet', () => {
  it('没装插件：不连、弹「获取 0x4 Wallet」卡片（没配商店地址时是「即将上线」）；对照：装了就直接连、面板关掉', async () => {
    expect(await connectOx4()).toBe(false)
    expect(useWalletGate.getState().getOx4).toBe(true)
    expect(useWallet.getState().wallet).toBeNull()
    useWalletGate.setState({ open: true, getOx4: false })
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    expect(await connectOx4()).toBe(true)
    expect(useWalletGate.getState().open).toBe(false)
    expect(useWalletGate.getState().getOx4).toBe(false)
  })

  it('装了：请插件连接，地址和签名器挂到钱包上，登录签名走插件的专用入口', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    expect(await connectOx4()).toBe(true)
    const w = useWallet.getState()
    expect(w.address).toBe(f.accounts.address)
    expect(w.evmAddress).toBe(f.accounts.evmAddress)
    expect(w.btcAddress).toBe('bc1qtest')
    expect(w.keysUnlocked).toBe(true)
    expect(w.vault).toBeNull()   // 网页版不存金库
    const login = await (w.wallet as unknown as { signLogin: (m: string) => Promise<{ chain: string }> }).signLogin('hello')
    expect(login.chain).toBe('solana')
    expect(f.calls).toContain('signLogin')
  })

  it('签名前过闸：插件锁了先请它解锁（connect 会弹解锁），再签', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    f.state.unlocked = false
    f.calls.length = 0
    await useWallet.getState().wallet!.signMessage(new Uint8Array([1, 2, 3]))
    expect(f.calls).toEqual(['status', 'connect', 'signSolanaMessage'])
  })

  it('插件锁定（2026-10-06 起）：钱包和登录令牌都留着，只标成锁着；解锁事件去掉锁；对照：断开才清掉钱包和令牌', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    localStorage.setItem('0x4.webSession', JSON.stringify({ address: f.accounts.address, token: 't', v: 3 }))
    f.state.unlocked = false
    f.emit('lock')
    expect(useWallet.getState().wallet).not.toBeNull()
    expect(useWallet.getState().address).toBe(f.accounts.address)
    expect(useWallet.getState().keysUnlocked).toBe(false)
    expect(localStorage.getItem('0x4.webSession')).not.toBeNull()
    // 插件在自己的弹窗里解锁：推 accountsChanged（地址没变）→ 去掉锁，不重新挂、不弹窗
    f.calls.length = 0
    f.state.unlocked = true
    f.emit('accountsChanged', f.accounts)
    expect(useWallet.getState().keysUnlocked).toBe(true)
    expect(f.calls).not.toContain('connect')
    f.emit('disconnect')
    expect(useWallet.getState().wallet).toBeNull()
    expect(localStorage.getItem('0x4.webSession')).toBeNull()
    localStorage.clear()
  })

  it('锁着时别处的 ensureUnlocked（合约、燃料费……）交给插件解锁，不等本机验证面板；解锁后标成没锁。用户关掉窗口按取消处理', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    f.state.unlocked = false
    f.emit('lock')
    f.calls.length = 0
    await ensureUnlocked('测试')
    expect(f.calls).toEqual(['status', 'connect'])
    expect(useWallet.getState().keysUnlocked).toBe(true)
    // 「解锁」按钮：用户在插件里关掉窗口（4001）→ 返回 false、不报错
    f.state.unlocked = false
    f.emit('lock')
    ;(f.p as unknown as { connect: unknown }).connect = async () => { throw { code: 4001, message: 'User rejected' } }
    expect(await unlockOx4()).toBe(false)
    expect(useWallet.getState().keysUnlocked).toBe(false)
  })

  it('锁着时私信不去请插件解密（会弹解锁窗口），标成「解锁后查看」；对照：没锁就照常解密', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    const row = { id: 'm1', from: 'a', to: 'b', ts: 1, ciphertext: 'c', nonce: 'n', epk: 'e' }
    const dm = () => useWallet.getState().dm!
    expect((await decodeDm(row, (x) => dm().decrypt(x))).text).toBe('你好')
    f.state.unlocked = false
    f.emit('lock')
    f.calls.length = 0
    const m = await decodeDm(row, (x) => dm().decrypt(x))
    expect(m.locked).toBe(true)
    expect(m.undecryptable).toBe(true)   // 不存本机、不 ack，解锁后从服务器重新拉
    expect(f.calls).not.toContain('dmDecrypt')
  })

  it('打开网页：插件已连过就直接挂上、不弹窗，锁着也挂上（标成锁着）；对照：没连过就保持没钱包', async () => {
    const f = fakeOx4({ connected: true, unlocked: true })
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await restoreOx4()
    expect(useWallet.getState().address).toBe(f.accounts.address)
    expect(useWallet.getState().keysUnlocked).toBe(true)
    expect(f.calls).not.toContain('connect')
    useWallet.getState().detachExtension()
    const l = fakeOx4({ connected: true, unlocked: false })
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = l.p
    await restoreOx4()
    expect(useWallet.getState().address).toBe(l.accounts.address)
    expect(useWallet.getState().keysUnlocked).toBe(false)
    expect(l.calls).not.toContain('connect')
    useWallet.getState().detachExtension()
    const g = fakeOx4({ connected: false, unlocked: false })
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = g.p
    await restoreOx4()
    expect(useWallet.getState().wallet).toBeNull()
    expect(g.calls).not.toContain('connect')
  })

  it('打开网页时插件没连着（断开时网页没开着）：本机存的网页版登录令牌删掉；对照：连着的，锁没锁都保留（2026-10-06 起）', async () => {
    const saved = JSON.stringify({ address: 'x', token: 't', v: 2 })
    localStorage.setItem('0x4.webSession', saved)
    const f = fakeOx4({ connected: false, unlocked: false })
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await restoreOx4()
    expect(localStorage.getItem('0x4.webSession')).toBeNull()
    for (const st of [{ connected: true, unlocked: false }, { connected: true, unlocked: true }]) {
      useWallet.getState().detachExtension()
      localStorage.setItem('0x4.webSession', saved)
      const g = fakeOx4(st)
      ;(window as unknown as { ox4: Ox4Provider }).ox4 = g.p
      await restoreOx4()
      expect(localStorage.getItem('0x4.webSession'), JSON.stringify(st)).toBe(saved)
    }
    localStorage.clear()
  })

  it('合约交易密钥走插件：agentFor 拿插件派生的地址，不签「0x4 perp agent v2」原始消息', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    const agent = await agentFor(useWallet.getState().evmAccount!)
    expect(agent.address).toBe('0x000000000000000000000000000000000000a9e7')
    expect(f.calls).toContain('agentAddress')
    expect(f.calls).not.toContain('signEvmMessage')
  })
})

// 2026-09-29 审查：合约只读查询以前是「插件不弹窗签名、交回网页、网页自己请求交易所」，签名能被拿去调不带业务参数的写接口。
// 现在网页版只读查询一律交给插件 perpRead 代办：网页拿不到签名、也不自己向交易所发私有请求
describe('合约只读查询走插件代办', () => {
  it('查账户 / 挂单 / 成交 / 杠杆分档：只调 perpRead（接口名 + 白名单参数），不调 signAgentTypedData，网页不自己请求交易所', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const acc = useWallet.getState().evmAccount!
    expect((await loadAccount(acc)).accountValue).toBe(12.5)
    expect(await loadOpenOrders(acc)).toEqual([])
    expect((await loadFills(acc, 30))[0].px).toBe(100)
    expect((await loadLeverageBrackets(acc)).BTC).toBe(125)
    expect(f.calls.filter((c) => c.startsWith('perpRead'))).toEqual(['perpRead:account:{}', 'perpRead:openOrders:{}', 'perpRead:userTrades:{"limit":"30"}', 'perpRead:leverageBracket:{}'])
    expect(f.calls).not.toContain('signAgentTypedData')
    expect(f.calls).not.toContain('agentAddress')
    expect(fetchMock.mock.calls.some((c) => String((c as unknown[])[0]).includes('fapi.asterdex.com'))).toBe(false)
  })

  it('交易所回「没授权」→ 抛 NO_AGENT（页面按还没开通显示），一分钟内不再去问；插件锁着 4900 原样抛出；老插件没有 perpRead 提示更新', async () => {
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    const acc = useWallet.getState().evmAccount!
    const saved = perpReply
    try {
      perpReply = async () => ({ status: 400, body: { code: -1000, msg: 'No agent found' } })
      await expect(loadOpenOrders(acc)).rejects.toThrow('NO_AGENT')
      const n = f.calls.length
      await expect(loadOpenOrders(acc)).rejects.toThrow('NO_AGENT')
      expect(f.calls.length).toBe(n)   // 一分钟内不再问插件
    } finally { perpReply = saved }
    useWallet.getState().detachExtension()
    const g = fakeOx4()
    ;(g.p as unknown as { perpRead: unknown }).perpRead = async () => { throw { code: 4900, message: 'locked' } }
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = g.p
    await connectOx4()
    const e = await loadAccount(useWallet.getState().evmAccount!).catch((x) => x)
    expect((e as { code?: number }).code).toBe(4900)
    useWallet.getState().detachExtension()
    const old = fakeOx4()
    ;(old.p as unknown as { perpRead: unknown }).perpRead = async () => { throw { code: 4200, message: 'Unsupported method' } }
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = old.p
    await connectOx4()
    await expect(loadAccount(useWallet.getState().evmAccount!)).rejects.toThrow(/更新 0x4 浏览器插件|Update the 0x4 browser extension/)
    expect(old.calls).not.toContain('signAgentTypedData')
  })
})

describe('没连钱包时的拦截', () => {
  it('要账号的操作：needWallet 返回 true 并去连（没装插件弹说明）；连上后返回 false 放行', async () => {
    expect(needWallet()).toBe(true)
    await vi.waitFor(() => expect(useWalletGate.getState().open).toBe(true), { timeout: 2000 })
    const f = fakeOx4()
    ;(window as unknown as { ox4: Ox4Provider }).ox4 = f.p
    await connectOx4()
    expect(needWallet()).toBe(false)
  })

  it('社交写操作（发帖等）没连钱包时不发请求、不报错（按用户取消处理）；读操作照常发', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const e = await api('/api/posts', { method: 'POST', body: '{}' }).catch((x) => x)
    expect((e as Error).name).toBe('WalletRequired')
    expect(fetchMock).not.toHaveBeenCalled()
    await api('/api/feed?scope=global')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
