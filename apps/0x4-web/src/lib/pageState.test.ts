// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_STATE_KEY, createPageStateStore, isBool, isString, oneOf, posInt, readPageState } from './pageState'

describe('页面状态会话记忆', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('没记过：用默认值（支持惰性默认值）', () => {
    const s = createPageStateStore(null)
    expect(readPageState('discover.view', 'market', undefined, s)).toBe('market')
    expect(readPageState('discover.view', () => 'favorites', undefined, s)).toBe('favorites')
  })

  it('记过什么读回什么', () => {
    const s = createPageStateStore(null)
    s.set('discover.view', 'hot'); s.set('discover.chain', 'bsc'); s.set('discover.shown', 60)
    expect(readPageState('discover.view', 'market', oneOf('market', 'hot'), s)).toBe('hot')
    expect(readPageState('discover.chain', 'all', isString, s)).toBe('bsc')
    expect(readPageState('discover.shown', 20, posInt(), s)).toBe(60)
  })

  it('值不合法（旧版本 / 写坏）：回到默认', () => {
    const s = createPageStateStore(null)
    s.set('discover.view', 'wallet'); s.set('discover.shown', -5); s.set('perp.shown', 1e9); s.set('settings.advanced', 'yes')
    expect(readPageState('discover.view', 'market', oneOf('market', 'hot'), s)).toBe('market')
    expect(readPageState('discover.shown', 20, posInt(), s)).toBe(20)
    expect(readPageState('perp.shown', 20, posInt(), s)).toBe(20)
    expect(readPageState('settings.advanced', false, isBool, s)).toBe(false)
  })

  it('镜像到 sessionStorage 的 0x4.pageState：WebView 重载后新建的 store 读得回来', () => {
    vi.useFakeTimers()
    const a = createPageStateStore(sessionStorage)
    a.set('community.tab', 'friends')
    a.set('community.scope', 'friends')
    vi.advanceTimersByTime(200)
    expect(PAGE_STATE_KEY.startsWith('0x4.')).toBe(true)
    expect(sessionStorage.getItem(PAGE_STATE_KEY)).toContain('community.tab')
    const b = createPageStateStore(sessionStorage)
    expect(b.get('community.tab')).toBe('friends')
    expect(b.get('community.scope')).toBe('friends')
  })

  it('连续写入合并成一次落盘（搜索框每个字不各写一次）', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const s = createPageStateStore(sessionStorage)
    for (const q of ['b', 'bt', 'btc']) s.set('discover.q', q)
    vi.advanceTimersByTime(200)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(createPageStateStore(sessionStorage).get('discover.q')).toBe('btc')
  })

  it('存储内容写坏了：当作空的，不抛错', () => {
    sessionStorage.setItem(PAGE_STATE_KEY, '{not json')
    expect(() => createPageStateStore(sessionStorage)).not.toThrow()
    expect(createPageStateStore(sessionStorage).size()).toBe(0)
    sessionStorage.setItem(PAGE_STATE_KEY, JSON.stringify({ a: 1 }))
    expect(createPageStateStore(sessionStorage).size()).toBe(0)
  })

  it('存储不可用（隐私模式）：只在内存里记，照常可用', () => {
    vi.useFakeTimers()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const s = createPageStateStore(sessionStorage)
    s.set('perp.tab', 'gain')
    expect(() => vi.advanceTimersByTime(200)).not.toThrow()
    expect(s.get('perp.tab')).toBe('gain')
  })

  it('条目有上限，淘汰最久没用的；读一次算用过', () => {
    const s = createPageStateStore(null, 3)
    s.set('token.view:a', 'posts'); s.set('token.view:b', 'posts'); s.set('token.view:c', 'posts')
    s.get('token.view:a')            // a 刚用过
    s.set('token.view:d', 'posts')   // 挤掉最久没用的 b
    expect(s.size()).toBe(3)
    expect(s.get('token.view:b')).toBeUndefined()
    expect(s.get('token.view:a')).toBe('posts')
    expect(s.get('token.view:d')).toBe('posts')
  })

  it('不和已有的 localStorage 键冲突', () => {
    const s = createPageStateStore(sessionStorage)
    s.set('x', 1)
    expect(localStorage.getItem(PAGE_STATE_KEY)).toBeNull()
  })
})
