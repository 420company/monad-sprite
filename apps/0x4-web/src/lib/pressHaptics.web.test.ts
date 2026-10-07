// @vitest-environment jsdom
// 按键轻震：网页版（app.420.meme）不挂监听、不震
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ impact: 0 }))
vi.mock('@capacitor/core', async (orig) => {
  const actual = await orig<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => false, getPlatform: () => 'web' } }
})
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(async () => { h.impact++ }), notification: vi.fn(async () => {}), vibrate: vi.fn(async () => {}) },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS', Error: 'ERROR' },
}))

const { installPressHaptics } = await import('./pressHaptics')
const { tap } = await import('./native')

describe('按键轻震（网页版）', () => {
  it('网页里点按钮不震', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const off = installPressHaptics()
    expect(add).not.toHaveBeenCalledWith('click', expect.anything(), true)
    document.body.innerHTML = '<button id="b">x</button>'
    document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    tap()
    expect(h.impact).toBe(0)
    off()
  })
})
