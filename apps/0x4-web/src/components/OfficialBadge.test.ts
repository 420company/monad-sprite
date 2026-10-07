// @vitest-environment jsdom
// 官方社区金色认证标 + 币详情页社区榜单：
// ① OfficialBadge 渲染成金色锯齿章 + 白色对勾，读屏念「官方社区」
// ② 榜单只有「持币最多的社区」前 3 名，官方社区不再单独成块（哪怕老接口还带着 official 字段），上榜时行内带金色标，普通群永远没有
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { CommunityCard } from '@/lib/social'

const card = (id: string, official: boolean): CommunityCard => ({ id, name: `群${id}`, avatar: null, memberCount: 10, holders: 4, totalUsd: 1234, joinMode: 'open', gated: false, official })
const apiMock = vi.fn()
vi.mock('@/lib/social', async (orig) => ({ ...(await orig<typeof import('@/lib/social')>()), api: (...a: unknown[]) => apiMock(...a) }))

const { default: OfficialBadge } = await import('./OfficialBadge')
const { resetStaffBadges } = await import('@/lib/staffBadges')
const { default: TokenCommunities, CommunityList } = await import('./TokenCommunities')

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
// 员工标记是 80 毫秒后批量去问的：先清掉还没发出的那一批，再清接口替身。
// 顺序反了的话，慢的机器上那一批会在清空之后才发出，拿到 undefined 调 .then 抛出未处理的异常，整轮测试退出码变 1（GPT 复审 b01f159 时复现）
afterEach(() => { act(() => root.unmount()); host.remove(); resetStaffBadges(); apiMock.mockReset() })
const inRouter = (el: ReturnType<typeof createElement>) => createElement(MemoryRouter, null, el)
const badges = () => host.querySelectorAll('[data-official-badge]')

describe('OfficialBadge', () => {
  it('金色锯齿章 + 白色对勾，有无障碍名字', () => {
    act(() => root.render(createElement(OfficialBadge, { size: 20 })))
    const svg = host.querySelector('svg')!
    expect(svg.getAttribute('aria-label')).toBe('官方社区')
    expect(svg.getAttribute('width')).toBe('20')
    const seal = svg.querySelector('polygon')!
    expect(seal.getAttribute('points')!.split(' ').length).toBe(24) // 12 个尖角
    expect(seal.getAttribute('fill')).toMatch(/^url\(#ob-/)
    const stops = [...svg.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'))
    expect(stops).toEqual(['#F8D66A', '#E2A93B', '#C98A1E'])
    expect(svg.querySelector('path')!.getAttribute('stroke')).toBe('#fff')
  })
  it('同一页多个标，渐变 id 不冲突', () => {
    act(() => root.render(createElement('div', null, createElement(OfficialBadge), createElement(OfficialBadge))))
    const ids = [...host.querySelectorAll('linearGradient')].map((g) => g.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('币详情页社区榜单', () => {
  it('官方群上榜时行内带金色标，普通群没有；最多 3 行', () => {
    act(() => root.render(inRouter(createElement(CommunityList, { top: [card('a', false), card('b', true), card('c', false), card('d', false)], symbol: 'FTC', onCreate: () => {} }))))
    const rows = [...host.querySelectorAll('a')]
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/g/a', '/g/b', '/g/c'])
    expect(badges().length).toBe(1)
    expect(rows[1].querySelector('[data-official-badge]')).not.toBeNull()
    expect(rows[0].querySelector('[data-official-badge]')).toBeNull()
  })
  it('空榜单给「建一个群」', () => {
    const onCreate = vi.fn()
    act(() => root.render(inRouter(createElement(CommunityList, { top: [], symbol: 'FTC', onCreate }))))
    expect(host.textContent).toContain('还没有 FTC 持有者聚集的群')
    act(() => (host.querySelector('button') as HTMLButtonElement).click())
    expect(onCreate).toHaveBeenCalled()
  })
  it('不再有单独的官方社区区块：接口就算还带着 official 字段也不显示', async () => {
    apiMock.mockResolvedValue({ official: card('old', true), top: [card('x', false)] })
    await act(async () => { root.render(inRouter(createElement(TokenCommunities, { chain: 'bsc', address: '0x21aac796151375e3747d5aa3933a45085a6a720e', symbol: 'FTC' }))) })
    await act(async () => { await Promise.resolve() })
    expect(apiMock).toHaveBeenCalledWith('/api/tokens/bsc/0x21aac796151375e3747d5aa3933a45085a6a720e/communities')
    expect(host.querySelector('h2')!.textContent).toBe('持币最多的社区')
    expect(host.querySelectorAll('h2, h3').length).toBe(1)
    expect([...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/g/x'])
    expect(host.textContent).not.toContain('群old')
    expect(badges().length).toBe(0)
  })
})
