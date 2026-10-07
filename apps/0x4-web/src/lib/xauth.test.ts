/**
 * @vitest-environment jsdom
 */
// Auth-window return handling: close the window only when "I am the opened window" AND "the URL carries a result" —
// otherwise it would close a page the user is browsing normally.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleXAuthPopup, onXAuthResult } from './xauth'

const setHash = (h: string) => { window.location.hash = h }


describe('handleXAuthPopup', () => {
  let close: ReturnType<typeof vi.fn>
  beforeEach(() => {
    close = vi.fn()
    vi.stubGlobal('close', close)
    Object.defineProperty(window, 'close', { value: close, configurable: true, writable: true })
    localStorage.clear()
  })
  afterEach(() => { (window as { opener?: unknown }).opener = null; vi.unstubAllGlobals() })

  it('普通访问：不关窗', () => {
    setHash('#/settings')
    ;(window as { opener?: unknown }).opener = null
    expect(handleXAuthPopup()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('是授权窗口且带结果：通知原页面并关窗', () => {
    setHash('#/settings?x=linked')
    ;(window as { opener?: unknown }).opener = {}
    expect(handleXAuthPopup()).toBe(true)
    expect(close).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('0x4.x-auth-result')!).x).toBe('linked')
  })

  it('是授权窗口但地址里没结果：不关窗', () => {
    setHash('#/settings')
    ;(window as { opener?: unknown }).opener = {}
    expect(handleXAuthPopup()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('失败原因一起带回去', () => {
    setHash('#/settings?x=failed&reason=' + encodeURIComponent('用户取消授权'))
    ;(window as { opener?: unknown }).opener = {}
    handleXAuthPopup()
    const saved = JSON.parse(localStorage.getItem('0x4.x-auth-result')!)
    expect(saved).toMatchObject({ x: 'failed', reason: '用户取消授权' })
  })
})

describe('onXAuthResult', () => {
  it('收到跨标签页的结果', () => {
    const cb = vi.fn()
    const off = onXAuthResult(cb)
    window.dispatchEvent(new StorageEvent('storage', { key: '0x4.x-auth-result', newValue: JSON.stringify({ x: 'linked' }) }))
    expect(cb).toHaveBeenCalledWith({ x: 'linked' })
    off()
    window.dispatchEvent(new StorageEvent('storage', { key: '0x4.x-auth-result', newValue: JSON.stringify({ x: 'failed' }) }))
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
