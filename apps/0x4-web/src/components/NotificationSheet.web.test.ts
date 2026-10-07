// @vitest-environment jsdom
// 震动设置只在原生 App 显示：网页版（app.420.meme）的「通知」面板里没有「震动」和「收到提醒时震动」
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

vi.hoisted(() => {
  // jsdom 没有 matchMedia，主题 / 弹层一加载就会调
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  }
})
vi.mock('@capacitor/core', async (orig) => {
  const actual = await orig<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => false, getPlatform: () => 'web' } }
})
vi.mock('@/lib/social', async (orig) => ({ ...(await orig<typeof import('@/lib/social')>()), api: vi.fn(async () => ({})) }))

const { default: NotificationSheet } = await import('./NotificationSheet')
const host = document.createElement('div'); document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => { act(() => root.render(null)) })

describe('通知面板（网页版）', () => {
  it('不显示震动设置', () => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    act(() => root.render(createElement(NotificationSheet, { open: true, onClose: () => {} })))
    const text = document.body.textContent || ''
    expect(text).toContain('通知')
    expect(text).not.toContain('收到提醒时震动')
    expect(document.querySelector('[aria-label="震动"]')).toBeNull()
  })
})
