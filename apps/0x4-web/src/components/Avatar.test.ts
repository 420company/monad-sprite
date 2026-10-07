// @vitest-environment jsdom
// 工作人员头像发光边框：
// ① 服务端说是 admin / support → 头像外面套发光层（柔光 + 旋转描边），圆头像是圆环、NFT 头像是六边形环
// ② 普通用户没有；同一批地址合并成一次请求、去重、问过的不再问
// ③ 个人主页标签：admin「官方」、support「客服」、普通用户不显示
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const apiMock = vi.fn()
vi.mock('@/lib/social', async (orig) => ({ ...(await orig<typeof import('@/lib/social')>()), api: (...a: unknown[]) => apiMock(...a) }))

const { default: Avatar } = await import('./Avatar')
const { default: StaffTag } = await import('./StaffTag')
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
    if (path.startsWith('/api/users/avatar-nfts')) return {}
    throw new Error(`unexpected ${path}`)
  })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); apiMock.mockReset(); vi.useRealTimers() })

async function flush() {
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); await Promise.resolve() })
}
const glowOf = (el: Element | null) => el?.closest('[data-staff-glow]') ?? null
const staffCalls = () => apiMock.mock.calls.filter(([p]) => String(p).startsWith('/api/users/staff-badges'))

describe('Avatar 工作人员发光边框', () => {
  it('管理员的像素头像：圆形发光环；普通用户没有；一批只问一次', async () => {
    act(() => root.render(createElement('div', null,
      createElement(Avatar, { address: ADMIN, size: 28 }),
      createElement(Avatar, { address: ALICE, size: 28 }),
      createElement(Avatar, { address: ADMIN, size: 76 }),
    )))
    expect(host.querySelector('[data-staff-glow]')).toBeNull() // 服务端没回话之前不画
    await flush()
    expect(staffCalls().length).toBe(1)
    const q = String(staffCalls()[0][0])
    expect(q.split('=')[1].split(',').sort()).toEqual([ADMIN, ALICE].sort()) // 去重

    const glows = [...host.querySelectorAll('[data-staff-glow]')]
    expect(glows.length).toBe(2)
    const g = glows[0] as HTMLElement
    expect(g.dataset.staffGlow).toBe('admin')
    expect(g.dataset.shape).toBe('circle')
    expect(g.style.width).toBe('28px') // 占位和头像一样大，不挤布局
    const ring = g.querySelector('.sg-ring') as HTMLElement
    expect(ring.style.clipPath).toMatch(/^path\(evenodd, /)
    expect(ring.querySelector('.sg-spin')).not.toBeNull()
    expect(g.querySelector('.sg-halo')).not.toBeNull()
    expect(g.querySelector('svg')).not.toBeNull() // 头像本体还在里面
    // 普通用户的头像外面什么都没有
    const aliceSvg = [...host.querySelectorAll('svg')].find((s) => !glowOf(s))
    expect(aliceSvg).toBeTruthy()

    // 再渲染一次不重复请求
    act(() => root.render(createElement(Avatar, { address: ALICE, size: 28 })))
    await flush()
    expect(staffCalls().length).toBe(1)
  })

  it('客服的 NFT 头像：六边形发光环', async () => {
    act(() => root.render(createElement(Avatar, { address: SUPPORT, src: 'https://example.com/a.png', chainId: 56, size: 40 })))
    await flush()
    const g = host.querySelector('[data-staff-glow]') as HTMLElement
    expect(g.dataset.staffGlow).toBe('support')
    expect(g.dataset.shape).toBe('hex')
    const clip = (g.querySelector('.sg-ring') as HTMLElement).style.clipPath
    expect(clip).toMatch(/^path\(evenodd, /)
    expect(clip).toContain('Q') // 圆角六边形路径（二次贝塞尔拐角），不是圆弧
    expect(clip).not.toContain('A')
    expect(g.querySelector('img')?.style.clipPath).toMatch(/^path\(/)
  })

  it('接口失败：不画边框，下次再问', async () => {
    apiMock.mockImplementation(async () => { throw new Error('offline') })
    act(() => root.render(createElement(Avatar, { address: ADMIN, size: 28 })))
    await flush()
    expect(host.querySelector('[data-staff-glow]')).toBeNull()
  })
})

describe('StaffTag 个人主页标签', () => {
  it('管理员「官方」、客服「客服」、普通用户不显示', async () => {
    act(() => root.render(createElement('div', null,
      createElement(StaffTag, { address: ADMIN }),
      createElement(StaffTag, { address: SUPPORT }),
      createElement(StaffTag, { address: ALICE }),
    )))
    await flush()
    const tags = [...host.querySelectorAll('[data-staff-tag]')]
    expect(tags.map((e) => e.textContent)).toEqual(['官方', '客服'])
  })
})
