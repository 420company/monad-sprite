// @vitest-environment jsdom
// Home page's today-P&L and account badge (2026-09-29 goat):
// (1) the line under the balance: green up, red down, neutral zero; hiding the balance hides amount and percentage together; when the percentage is unavailable show only the amount
// (2) the panel: wallet / perp-account breakdown; when perp data is unreadable the perp row doesn't appear (never shown as 0); the baseline method is noted
// (3) the badge: shown only when the fee-tier API returns the current account's tier — gold for VIP, neutral for regular accounts; hidden on API failure or account switch
// (4) after the home page refreshes balances, record once: register held tokens (not stablecoins), take the midnight price at day change, null when perp data is unreadable
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DaySummary } from '@/lib/dayPnl'

vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
const apiMock = vi.fn()
vi.mock('@/lib/social', async (orig) => ({ ...(await orig<typeof import('@/lib/social')>()), api: (...a: unknown[]) => apiMock(...a) }))

const { DayPnlLine, DayPnlSheet, AccountBadge } = await import('./DayPnl')
const { useFees } = await import('@/lib/fees')
const { useSocial } = await import('@/store/social')
const { useWallet } = await import('@/store/wallet')
const { usePortfolio } = await import('@/store/portfolio')
const { useDayPnl } = await import('@/store/dayPnl')
const { startOfDayCst } = await import('@/lib/dayPnl')

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.querySelectorAll('dialog').forEach((d) => d.remove()); apiMock.mockReset(); vi.unstubAllGlobals() })
const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el))
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const sum = (over: Partial<DaySummary> = {}): DaySummary => ({ pnl: 12.34, pct: 1.02, spot: { pnl: 12.34, partial: 0 }, perp: null, ...over })
const line = () => host.querySelector('[data-testid=day-pnl]') as HTMLButtonElement | null
const amount = () => line()!.querySelectorAll('span')[1] as HTMLSpanElement

describe('余额下面的今日盈亏', () => {
  it('盈利：绿色，带正号和百分比', () => {
    render(createElement(DayPnlLine, { summary: sum(), hidden: false, onOpen: () => {} }))
    expect(line()!.textContent).toContain('今日盈亏')
    expect(amount().textContent).toBe('+$12.34(+1.02%)')
    expect(amount().className).toContain('text-up')
  })
  it('亏损：红色，负号', () => {
    render(createElement(DayPnlLine, { summary: sum({ pnl: -5, pct: -2.5 }), hidden: false, onOpen: () => {} }))
    expect(amount().textContent).toBe('-$5.00(-2.50%)')
    expect(amount().className).toContain('text-down')
  })
  it('零：中性色，不带正负号', () => {
    render(createElement(DayPnlLine, { summary: sum({ pnl: 0.001, pct: 0.0001 }), hidden: false, onOpen: () => {} }))
    expect(amount().textContent).toBe('$0.00(0.00%)')
    expect(amount().className).toContain('text-muted')
    expect(amount().className).not.toMatch(/text-(up|down)/)
  })
  it('隐藏余额：金额和百分比都不出现（阴性对照：不隐藏时出现）', () => {
    render(createElement(DayPnlLine, { summary: sum(), hidden: true, onOpen: () => {} }))
    expect(line()!.textContent).toContain('****')
    expect(line()!.textContent).not.toMatch(/12\.34|1\.02/)
    render(createElement(DayPnlLine, { summary: sum(), hidden: false, onOpen: () => {} }))
    expect(line()!.textContent).toMatch(/12\.34/)
  })
  it('百分比拿不到（初始资产太少）：只显示金额', () => {
    render(createElement(DayPnlLine, { summary: sum({ pct: null }), hidden: false, onOpen: () => {} }))
    expect(amount().textContent).toBe('+$12.34')
  })
  it('还没有数据：整行不显示', () => {
    render(createElement(DayPnlLine, { summary: null, hidden: false, onOpen: () => {} }))
    expect(line()).toBeNull()
  })
  it('点一下打开面板', () => {
    const onOpen = vi.fn()
    render(createElement(DayPnlLine, { summary: sum(), hidden: false, onOpen }))
    act(() => line()!.click())
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('今日盈亏面板', () => {
  const text = () => document.querySelector('dialog')?.textContent || ''
  it('合约读不到：只有钱包一行，没有合约账户一行', () => {
    render(createElement(DayPnlSheet, { open: true, onClose: () => {}, summary: sum(), hidden: false, walletUsd: 1000 }))
    expect(text()).toContain('钱包')
    expect(text()).toContain('资产 $1,000.00')
    expect(text()).not.toContain('合约账户')
    expect(text()).toContain('充值、提现、转账、兑换及其手续费不计入')
  })
  it('合约读得到：分项显示，合约起点晚于 0 点时注明几点起算；部分币从首次读取起算也注明', () => {
    const day = startOfDayCst(Date.now())
    render(createElement(DayPnlSheet, { open: true, onClose: () => {}, summary: sum({ pnl: 9.34, spot: { pnl: 12.34, partial: 2 }, perp: { pnl: -3, base: 50, netIn: 0, equity: 47, since: day + 3 * 3600_000, late: true } }), hidden: false, walletUsd: 1000 }))
    expect(text()).toContain('合约账户')
    expect(text()).toContain('资产 $47.00')
    expect(text()).toContain('-$3.00')
    expect(text()).toContain('2 项资产从今天首次读取时起算')
    expect(text()).toContain('合约从北京时间 03:00 起算。') // Display in Beijing time, not the phone's timezone
  })
  it('隐藏余额：面板里的金额也隐藏', () => {
    render(createElement(DayPnlSheet, { open: true, onClose: () => {}, summary: sum(), hidden: true, walletUsd: 1000 }))
    expect(text()).not.toMatch(/12\.34|1,000/)
    expect(text()).toContain('****')
  })
  it('百分比拿不到时说明原因', () => {
    render(createElement(DayPnlSheet, { open: true, onClose: () => {}, summary: sum({ pct: null }), hidden: false, walletUsd: 0.5 }))
    expect(text()).toContain('初始资产不足 1 美元，不显示百分比。')
  })
})

describe('地址下的账户勋章', () => {
  const badge = () => host.querySelector('[data-testid=tier-badge]') as HTMLButtonElement | null
  beforeEach(() => {
    useSocial.setState({ status: 'ready', me: { address: 'Me111' } as never })
    useFees.setState({ loadedAt: 0, account: '' })
  })
  it('费率接口失败：不显示勋章（不猜普通还是 VIP）', async () => {
    apiMock.mockRejectedValue(new Error('offline'))
    await useFees.getState().load(true)
    render(createElement(AccountBadge, { onOpen: () => {} }))
    expect(badge()).toBeNull()
  })
  it('普通账户：中性样式', async () => {
    apiMock.mockResolvedValue({ vip: false })
    await useFees.getState().load(true)
    render(createElement(AccountBadge, { onOpen: () => {} }))
    expect(badge()!.textContent).toBe('普通账户')
    expect(badge()!.dataset.vip).toBe('false')
    expect(badge()!.querySelector('svg')).toBeNull()
  })
  it('VIP：金色样式带皇冠', async () => {
    apiMock.mockResolvedValue({ vip: true })
    await useFees.getState().load(true)
    render(createElement(AccountBadge, { onOpen: () => {} }))
    expect(badge()!.textContent).toBe('VIP')
    expect(badge()!.dataset.vip).toBe('true')
    expect(badge()!.querySelector('svg')).not.toBeNull()
  })
  it('切换了账户：上一个账户的等级不显示，等新账户的拿到了再显示', async () => {
    apiMock.mockResolvedValue({ vip: true })
    await useFees.getState().load(true)
    act(() => useSocial.setState({ me: { address: 'Other222' } as never }))
    render(createElement(AccountBadge, { onOpen: () => {} }))
    expect(badge()).toBeNull()
    apiMock.mockResolvedValue({ vip: false })
    await act(async () => { await useFees.getState().load() })
    expect(badge()!.textContent).toBe('普通账户')
  })
})

describe('首页记账', () => {
  const holding = (chainId: number, mint: string, amount: number, priceUsd: number, symbol = 'TKN') => ({ chainId, mint, amount, decimals: 18, symbol, name: symbol, priceUsd, valueUsd: amount * priceUsd })
  beforeEach(() => {
    localStorage.clear()
    useWallet.setState({ address: 'Acct111' })
    useSocial.setState({ status: 'ready', me: { address: 'Acct111' } as never })
    useDayPnl.setState({ account: '', ledger: null, perp: null, perpAt: 0, seen: 0, watchAt: 0 })
  })

  it('登记持有的币（不登记稳定币）；合约读不到时是 null', async () => {
    usePortfolio.setState({ holdings: [holding(56, '0xAbC', 10, 2), holding(56, '0x55d', 100, 1, 'USDT')], btc: null, btcFresh: false, scannedChains: [56], lastUpdated: Date.now() })
    apiMock.mockImplementation(async (path: string) => (path === '/api/pnl/perp' ? { available: false } : { ok: true }))
    await useDayPnl.getState().update()
    await flush()
    const watch = apiMock.mock.calls.find((c) => c[0] === '/api/pnl/watch')!
    expect(JSON.parse((watch[1] as RequestInit).body as string).tokens).toEqual([{ chainId: 56, token: '0xAbC' }])
    expect(useDayPnl.getState().perp).toBeNull()
    expect(useDayPnl.getState().ledger!.base).toBe(120)
    expect(JSON.parse(localStorage.getItem('0x4.daypnl.v1:Acct111')!).base).toBe(120)
  })

  it('合约读得到：记下合约部分；字段不全就当读不到', async () => {
    usePortfolio.setState({ holdings: [], btc: null, btcFresh: false, scannedChains: [56], lastUpdated: Date.now() })
    const since = startOfDayCst(Date.now())
    apiMock.mockImplementation(async (path: string) => (path === '/api/pnl/perp' ? { available: true, pnl: 5, base: 100, netIn: 0, equity: 105, since } : { ok: true }))
    await useDayPnl.getState().update()
    expect(useDayPnl.getState().perp).toEqual({ pnl: 5, base: 100, netIn: 0, equity: 105, since })
    useDayPnl.setState({ perpAt: 0 })
    apiMock.mockImplementation(async (path: string) => (path === '/api/pnl/perp' ? { available: true, pnl: 5 } : { ok: true }))
    await useDayPnl.getState().update()
    expect(useDayPnl.getState().perp).toBeNull()
  })

  it('换日：向服务器要 0 点价（EVM 地址小写），拿到的按 0 点价起算', async () => {
    const now = Date.now(), today = startOfDayCst(now)
    localStorage.setItem('0x4.daypnl.v1:Acct111', JSON.stringify({ v: 1, day: today - 86400_000, pnl: 0, base: 0, inflow: 0, outflow: 0, partial: [], pending: {}, last: { '56:0xabc': { q: 10, p: 1 }, '56:0x55d': { q: 100, p: 1, s: 1 } }, t: today - 3600_000 }))
    // The midnight-price endpoint requires login since 2026-09-29; goes through the tokened api()
    const urls: string[] = []
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/pnl/open')) { urls.push(path); return { day: today, prices: { '56:0xabc': 1.5 } } }
      return { available: false }
    })
    usePortfolio.setState({ holdings: [holding(56, '0xAbC', 10, 2), holding(56, '0x55d', 100, 1, 'USDT')], btc: null, btcFresh: false, scannedChains: [56], lastUpdated: now })
    await useDayPnl.getState().update()
    expect(urls).toHaveLength(1)
    expect(decodeURIComponent(urls[0])).toContain(`day=${today}&tokens=56:0xabc`)
    expect(decodeURIComponent(urls[0])).not.toContain('0x55d') // Stablecoins count as 1, no lookup needed
    const L = useDayPnl.getState().ledger!
    expect(L.day).toBe(today)
    expect(L.base).toBe(115)
    expect(L.pnl).toBe(5) // 10 units rising from a midnight price of 1.5 to 2
  })

  it('比特币这次没读到（沿用上一次的余额）：不算它（阴性对照：读到了就算）', async () => {
    const btc = holding(20000000000001, 'bitcoin', 1, 80000, 'BTC')
    apiMock.mockResolvedValue({ available: false })
    usePortfolio.setState({ holdings: [], btc, btcFresh: false, scannedChains: [], lastUpdated: 1 })
    await useDayPnl.getState().update()
    expect(useDayPnl.getState().ledger!.base).toBe(0)
    useDayPnl.setState({ ledger: null, seen: 0 })
    usePortfolio.setState({ btcFresh: true, lastUpdated: 2 })
    await useDayPnl.getState().update()
    expect(useDayPnl.getState().ledger!.base).toBe(80000)
  })
})
