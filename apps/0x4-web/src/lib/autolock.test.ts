/**
 * @vitest-environment jsdom
 */
// 自动锁定的测试。
//
// 这块逻辑一旦退化，后果分两种，都很难在日常使用里发现：
//   锁得太松 —— 手机放桌上别人拿起来就能花钱
//   锁得太紧 —— X 授权走到一半回来被锁在门外，用户以为 App 坏了
// 所以两个方向都要钉住。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lock = vi.fn()
let wallet: object | null = {}
let autoLockMs = 300_000

vi.mock('@/lib/native', () => ({ isNative: false, platform: 'web' }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }))
vi.mock('@/store/settings', () => ({ useSettings: { getState: () => ({ autoLockMs }) } }))
vi.mock('@/store/wallet', () => ({ useWallet: { getState: () => ({ wallet, lock }) } }))

const { initAutoLock, suspendAutoLock, resumeAutoLock, __testing } = await import('./autolock')

/** 让 document.hidden 可控，并派发 visibilitychange */
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
  // suspend 的计数是模块级的，用例之间必须归零，否则互相污染
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
  // ★ 假时钟必须在 initAutoLock 之前装好，否则它内部的 setInterval 是真定时器，
  //   advanceTimersByTime 拨不动（外层 beforeEach 先跑，所以这里要拆了重装一次）。
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
