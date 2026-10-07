// @vitest-environment jsdom
// Staff names' IKEA colors (yellow text, blue outline):
// 1. Server says admin / support → the name gets the staff-name class (the large variant additionally gets staff-name-lg)
// 2. Regular users display as-is, no class
// 3. API failure → display as a regular user, no guessing
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const apiMock = vi.fn()
vi.mock('@/lib/social', async (orig) => ({ ...(await orig<typeof import('@/lib/social')>()), api: (...a: unknown[]) => apiMock(...a) }))

const { default: UserName } = await import('./UserName')
const { resetStaffBadges } = await import('@/lib/staffBadges')

const ADMIN = 'Admin1111111111111111111111111111111111111'
const SUPPORT = '0x4204c45595b73b52eb4a652f574ed47e2a8e1420'
const ALICE = 'Alice1111111111111111111111111111111111111'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  resetStaffBadges()
  apiMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/users/staff-badges')) return { [ADMIN]: 'admin', [SUPPORT]: 'support' }
    throw new Error(`unexpected ${path}`)
  })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); apiMock.mockReset(); vi.useRealTimers() })

async function flush() {
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); await Promise.resolve() })
}
const render = (els: ReturnType<typeof createElement>[]) => act(() => root.render(createElement('div', null, ...els)))
const byText = (txt: string) => [...host.querySelectorAll('*')].find((e) => e.textContent === txt && e.children.length === 0) ?? null

describe('UserName', () => {
  // 2026-09-27 goat: admin and support names are no longer colored — same as regular users
  it('管理员、客服、普通用户的名字都不带 staff-name，调用方的 class 保留', async () => {
    render([
      createElement(UserName, { key: 1, address: ADMIN, name: 'Goat' }),
      createElement(UserName, { key: 2, address: SUPPORT, name: '小美', className: 'truncate' }),
      createElement(UserName, { key: 3, address: ALICE, name: 'Alice', className: 'font-semibold' }),
      createElement(UserName, { key: 4, address: ADMIN, name: 'Goat 大字', size: 'lg' }),
    ])
    await flush()
    expect(host.querySelectorAll('.staff-name, [data-staff-name]')).toHaveLength(0)
    expect(byText('小美')!.className).toBe('truncate')
    expect(byText('Alice')!.className).toBe('font-semibold')
  })

  it('不传 className 时只输出纯文字', async () => {
    render([createElement(UserName, { key: 1, address: ADMIN, name: 'Goat' })])
    await flush()
    expect(host.firstElementChild!.innerHTML).toBe('Goat')
  })
})
