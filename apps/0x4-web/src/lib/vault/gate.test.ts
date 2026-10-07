import { describe, expect, it } from 'vitest'
import { ensureUnlocked, finishUnlock, notifyLock, onLock, setUnlockedCheck, UnlockCancelled, useUnlockPrompt } from './gate'

describe('动钱才验证的闸门', () => {
  it('已解锁：直接放行，不弹面板', async () => {
    setUnlockedCheck(() => true)
    await ensureUnlocked()
    expect(useUnlockPrompt.getState().open).toBe(false)
  })

  it('锁着：弹一次面板，同时来的请求共用这次验证，验过全部放行', async () => {
    setUnlockedCheck(() => false)
    const a = ensureUnlocked('转账')
    const b = ensureUnlocked('别的')
    expect(useUnlockPrompt.getState()).toEqual({ open: true, reason: '转账' })
    finishUnlock(true)
    await expect(Promise.all([a, b])).resolves.toBeDefined()
    expect(useUnlockPrompt.getState().open).toBe(false)
  })

  it('用户取消：抛 UnlockCancelled，之后再请求会重新弹', async () => {
    setUnlockedCheck(() => false)
    const a = ensureUnlocked()
    finishUnlock(false)
    await expect(a).rejects.toBeInstanceOf(UnlockCancelled)
    const b = ensureUnlocked()
    expect(useUnlockPrompt.getState().open).toBe(true)
    finishUnlock(true)
    await b
  })

  it('锁定通知：注册的清理函数会被调用，注销后不再调用', () => {
    let n = 0
    const off = onLock(() => { n++ })
    notifyLock()
    off()
    notifyLock()
    expect(n).toBe(1)
  })
})
