// @vitest-environment jsdom
// 会议等候室前端逻辑（2026-10-01 goat）：
// ① 进会接口回 202 { waiting: true } 认成「在等候室」
// ② 等着的人每 3 秒问一次状态，同意 / 拒绝 / 被清出列表时停下来回调一次
// ③ 主持人 / 管理员：拉等待列表；允许 / 拒绝 / 全部允许 / 开关都发到服务器，用服务器回的列表；成员不拉
// ④ 等候室卡片：有人等才出现，显示名字和等了多久
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { isLobbyWaiting, useLobbyHost, useLobbyWait, waitedFor, LOBBY_POLL_MS, type LobbyHost, type LobbyApi } from './lobbyCore'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  vi.useFakeTimers()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('进会回复', () => {
  it('202 的等候室回复才算在等', () => {
    expect(isLobbyWaiting({ waiting: true, code: 'LOBBY_WAITING' })).toBe(true)
    expect(isLobbyWaiting({ token: 'x', url: 'ws://' })).toBe(false)
    expect(isLobbyWaiting(null)).toBe(false)
  })
  it('等了多久：1 分钟内按秒，之后按分钟', () => {
    expect(waitedFor(1000, 43_000)).toEqual({ unit: 's', n: 42 })
    expect(waitedFor(0, 185_000)).toEqual({ unit: 'm', n: 3 })
    expect(waitedFor(10_000, 5_000)).toEqual({ unit: 's', n: 0 })
  })
})

describe('等着的人问状态', () => {
  function Waiter({ api, active, onResult }: { api: LobbyApi; active: boolean; onResult: (s: string) => void }) {
    useLobbyWait(api, 'abc-defg-hij', active, onResult)
    return null
  }
  it('每 3 秒问一次，同意后停下并回调一次', async () => {
    const seq = ['waiting', 'waiting', 'admitted']
    const api = vi.fn(async () => ({ status: seq.shift() ?? 'admitted' })) as unknown as LobbyApi
    const got: string[] = []
    act(() => root.render(createElement(Waiter, { api, active: true, onResult: (s) => got.push(s) })))
    await advance(LOBBY_POLL_MS - 10)
    expect(api).toHaveBeenCalledTimes(0)
    await advance(20)
    expect(api).toHaveBeenCalledWith('/api/meet/meetings/abc-defg-hij/lobby/me')
    await advance(LOBBY_POLL_MS * 5)
    expect(got).toEqual(['admitted'])
    expect(api).toHaveBeenCalledTimes(3)
  })
  it('拒绝：回调 denied；网络出错不回调，下一轮接着问', async () => {
    let n = 0
    const api = vi.fn(async () => { if (++n === 1) throw new Error('net'); return { status: 'denied' } }) as unknown as LobbyApi
    const got: string[] = []
    act(() => root.render(createElement(Waiter, { api, active: true, onResult: (s) => got.push(s) })))
    await advance(LOBBY_POLL_MS * 3)
    expect(got).toEqual(['denied'])
  })
  it('没在等（active=false）不发请求', async () => {
    const api = vi.fn() as unknown as LobbyApi
    act(() => root.render(createElement(Waiter, { api, active: false, onResult: () => {} })))
    await advance(LOBBY_POLL_MS * 3)
    expect(api).not.toHaveBeenCalled()
  })
})

describe('主持人 / 管理员', () => {
  let lobby: LobbyHost
  function Host({ api, enabled }: { api: LobbyApi; enabled: boolean }) {
    lobby = useLobbyHost(api, 'abc-defg-hij', enabled, true, () => {})
    return null
  }
  const w = (address: string) => ({ address, name: address, avatar: null, since: 0 })
  it('拉列表；允许 / 拒绝 / 全部允许 / 关掉都发给服务器，界面用服务器回的列表', async () => {
    const calls: [string, unknown][] = []
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push([path, init?.body ? JSON.parse(String(init.body)) : null])
      if (!init) return { on: true, waiting: [w('A'), w('B'), w('C')] }
      if (path.endsWith('/lobby')) return { on: false, waiting: [] }
      return { ok: true, waiting: [w('C')] }
    }) as unknown as LobbyApi
    act(() => root.render(createElement(Host, { api, enabled: true })))
    await advance(0)
    expect(lobby.waiting.map((x) => x.address)).toEqual(['A', 'B', 'C'])
    await act(() => lobby.admit('A'))
    await act(() => lobby.deny('B'))
    await act(() => lobby.admitAll())
    expect(lobby.waiting.map((x) => x.address)).toEqual(['C'])
    await act(() => lobby.toggle(false))
    expect(lobby.on).toBe(false)
    expect(calls.filter(([, b]) => b)).toEqual([
      ['/api/meet/meetings/abc-defg-hij/lobby/admit', { address: 'A' }],
      ['/api/meet/meetings/abc-defg-hij/lobby/deny', { address: 'B' }],
      ['/api/meet/meetings/abc-defg-hij/lobby/admit', { all: true }],
      ['/api/meet/meetings/abc-defg-hij/lobby', { on: false }],
    ])
  })
  it('成员不拉等待列表', async () => {
    const api = vi.fn() as unknown as LobbyApi
    act(() => root.render(createElement(Host, { api, enabled: false })))
    await advance(10_000)
    expect(api).not.toHaveBeenCalled()
  })
})

describe('等候室卡片', () => {
  it('有人等才出现：名字、等了多久、允许 / 拒绝；两个人以上才有「全部允许」', async () => {
    const { LobbyHostCard } = await import('./Lobby')
    const base: LobbyHost = { on: true, waiting: [], toggle: vi.fn(), admit: vi.fn(), admitAll: vi.fn(), deny: vi.fn() }
    act(() => root.render(createElement(LobbyHostCard, { lobby: base })))
    expect(host.querySelector('[data-testid=lobby-card]')).toBeNull()
    const one = { ...base, waiting: [{ address: 'AAAA1111', name: '小明', avatar: null, since: Date.now() - 42_000 }] }
    act(() => root.render(createElement(LobbyHostCard, { lobby: one })))
    const card = host.querySelector('[data-testid=lobby-card]')!
    expect(card.textContent).toContain('小明')
    expect(card.textContent).toContain('42')
    expect(host.querySelector('[data-testid=lobby-admit-all]')).toBeNull()
    act(() => (host.querySelector('[data-testid=lobby-admit]') as HTMLButtonElement).click())
    expect(one.admit).toHaveBeenCalledWith('AAAA1111')
    act(() => (host.querySelector('[data-testid=lobby-deny]') as HTMLButtonElement).click())
    expect(one.deny).toHaveBeenCalledWith('AAAA1111')
    const two = { ...one, waiting: [...one.waiting, { address: 'BBBB2222', name: '小红', avatar: null, since: Date.now() }] }
    act(() => root.render(createElement(LobbyHostCard, { lobby: two })))
    act(() => (host.querySelector('[data-testid=lobby-admit-all]') as HTMLButtonElement).click())
    expect(two.admitAll).toHaveBeenCalled()
    // 等候室关了：不显示
    act(() => root.render(createElement(LobbyHostCard, { lobby: { ...two, on: false } })))
    expect(host.querySelector('[data-testid=lobby-card]')).toBeNull()
  })
})
