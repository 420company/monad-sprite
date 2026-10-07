/**
 * @vitest-environment jsdom
 */
// Auto-lock tests.
//
// If this logic regresses, two failure modes — both hard to notice in daily use:
//   Too loose — someone picking up the phone off the desk can spend
//   Too tight — returning mid-X-auth finds the door locked, looking like a broken app
// So both directions are pinned down.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lock = vi.fn()
let wallet: object | null = {}
let autoLockMs = 300_000

vi.mock('@/lib/native', () => ({ isNative: false, platform: 'web' }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }))
vi.mock('@/store/settings', () => ({ useSettings: { getState: () => ({ autoLockMs }) } }))
vi.mock('@/store/wallet', () => ({ useWallet: { getState: () => ({ wallet, lock }) } }))

const { initAutoLock, suspendAutoLock, resumeAutoLock, __testing } = await import('./autolock')

/** Make document.hidden controllable, and dispatch visibilitychange */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

let teardown: () => void

beforeEach(() => {
  lock.mockClear()
  wallet = {}
  autoLockMs = 300_000
  setHidden(false)
  __testing.setLeftAt(null)
  __testing.setLastActive(Date.now())
  teardown = initAutoLock()
})

afterEach(() => {
  teardown()
  // The suspend counter is module-level; it must reset between cases or they contaminate each other
  while (__testing.state().suspendDepth > 0) resumeAutoLock()
  vi.useRealTimers()
})

describe('切后台', () => {
  it('阈值内离开再回来不锁', () => {
    setHidden(true)
    setHidden(false)
    expect(lock).not.toHaveBeenCalled()
  })

  it('离开超过阈值回来就锁', () => {
    setHidden(true)
    __testing.setLeftAt(Date.now() - 300_001)
    setHidden(false)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('选「立即」时一离开当场就锁，不等回来', () => {
    autoLockMs = 0
    setHidden(true)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('选「从不」时离开多久都不锁', () => {
    autoLockMs = -1
    setHidden(true)
    __testing.setLeftAt(Date.now() - 86_400_000)
    setHidden(false)
    expect(lock).not.toHaveBeenCalled()
  })

  it('已经是锁着的状态不重复调 lock', () => {
    wallet = null
    setHidden(true)
    __testing.setLeftAt(Date.now() - 300_001)
    setHidden(false)
    expect(lock).not.toHaveBeenCalled()
  })
})

describe('外部浏览器流程豁免', () => {
  it('豁免期间离开再久回来也不锁（X 授权走到一半不能被踢出去）', () => {
    suspendAutoLock()
    setHidden(true)
    __testing.setLeftAt(Date.now() - 999_999)
    setHidden(false)
    expect(lock).not.toHaveBeenCalled()
  })

  it('豁免结束后恢复正常', () => {
    suspendAutoLock()
    resumeAutoLock()
    setHidden(true)
    __testing.setLeftAt(Date.now() - 300_001)
    setHidden(false)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('嵌套的豁免要全部结束才恢复（两个外部流程叠在一起时不能提前解除）', () => {
    suspendAutoLock()
    suspendAutoLock()
    resumeAutoLock()
    setHidden(true)
    __testing.setLeftAt(Date.now() - 300_001)
    setHidden(false)
    expect(lock).not.toHaveBeenCalled()
  })

  it('豁免恢复时算一次活动，回来后不会立刻被闲置计时器踢掉', () => {
    const before = Date.now()
    suspendAutoLock()
    __testing.setLastActive(before - 999_999)
    resumeAutoLock()
    expect(__testing.state().lastActiveAt).toBeGreaterThanOrEqual(before)
  })
})

describe('前台闲置', () => {
  // ★ The fake clock must be installed before initAutoLock, or its internal setInterval is a real timer
  //   that advanceTimersByTime can't move (the outer beforeEach runs first, so it's uninstalled and reinstalled here).
  beforeEach(() => {
    teardown()
    vi.useFakeTimers()
    teardown = initAutoLock()
  })

  it('没人动超过阈值就锁', () => {
    __testing.setLastActive(Date.now() - 300_001)
    vi.advanceTimersByTime(15_000)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('有交互就重新计时', () => {
    __testing.setLastActive(Date.now() - 300_001)
    document.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(15_000)
    expect(lock).not.toHaveBeenCalled()
  })

  it('选「立即」时前台不踢人（那条只管切后台）', () => {
    autoLockMs = 0
    __testing.setLastActive(Date.now() - 999_999)
    vi.advanceTimersByTime(15_000)
    expect(lock).not.toHaveBeenCalled()
  })

  it('页面隐藏时不跑闲置判断，交给切后台那条处理', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    __testing.setLastActive(Date.now() - 999_999)
    vi.advanceTimersByTime(15_000)
    expect(lock).not.toHaveBeenCalled()
  })
})

describe('卸载', () => {
  it('卸载后事件和定时器都不再触发', () => {
    teardown()
    teardown = () => {}
    setHidden(true)
    __testing.setLeftAt(Date.now() - 300_001)
    setHidden(false)
    expect(lock).not.toHaveBeenCalled()
  })
})
