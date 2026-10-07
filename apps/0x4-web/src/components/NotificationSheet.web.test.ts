// @vitest-environment jsdom
// Vibration settings only show in the native app: the web (app.420.meme) "Notifications" panel has no "Vibration" or "Vibrate on notification"
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

vi.hoisted(() => {
  // jsdom has no matchMedia; themes / overlays call it as soon as they load
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
