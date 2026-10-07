import { describe, expect, it } from 'vitest'
import { ScrollMemory, planScroll, restoreStep, RESTORE_TIMEOUT } from './scrollRestore'
import { canGoBack } from './useBack'
import { PAGED_CACHE_TTL, clearPagedCache, putPagedCache, takePagedCache } from './usePaged'

describe('滚动记忆', () => {
  it('每条历史记录各记各的：整页位置 + 独立滚动区', () => {
    const m = new ScrollMemory()
    m.saveWindow('discover', 1234.6)
    m.saveArea('post', 'post', 800)
    m.saveWindow('token', 300)
    expect(m.get('discover')).toEqual({ y: 1235, areas: {} })
    expect(m.get('post')).toEqual({ y: 0, areas: { post: 800 } })
    expect(m.get('token')?.y).toBe(300)
  })

  it('负数（iOS 橡皮筋回弹）记成 0', () => {
    const m = new ScrollMemory()
    m.saveWindow('a', -40)
    expect(m.get('a')?.y).toBe(0)
  })

  it('有上限，淘汰最早的记录', () => {
    const m = new ScrollMemory(2)
    m.saveWindow('a', 1); m.saveWindow('b', 2); m.saveWindow('c', 3)
    expect(m.size()).toBe(2)
    expect(m.get('a')).toBeUndefined()
    expect(m.get('c')?.y).toBe(3)
  })

  it('序列化后读回来一致；写坏的条目丢掉', () => {
    const m = new ScrollMemory()
    m.saveWindow('a', 500); m.saveArea('a', 'post', 90)
    const back = ScrollMemory.from(JSON.parse(JSON.stringify(m.toJSON())))
    expect(back.get('a')).toEqual({ y: 500, areas: { post: 90 } })
    const bad = ScrollMemory.from([['x', { y: 'nope' }], [1, { y: 3 }], ['ok', { y: 7, areas: { p: 'bad', q: 4 } }], 'junk'])
    expect(bad.size()).toBe(1)
    expect(bad.get('ok')).toEqual({ y: 7, areas: { q: 4 } })
    expect(ScrollMemory.from(null).size()).toBe(0)
  })
})

describe('进到一条记录时怎么滚', () => {
  const saved = { y: 1500, areas: {} }
  it('后退（POP）且有记录：恢复', () => {
    expect(planScroll('POP', saved)).toEqual({ mode: 'restore', entry: saved })
    expect(planScroll('POP', { y: 0, areas: { post: 300 } }).mode).toBe('restore')
  })
  it('新进入（PUSH）：回顶部，哪怕这个 key 记过', () => {
    expect(planScroll('PUSH', saved)).toEqual({ mode: 'top' })
    expect(planScroll('PUSH', undefined)).toEqual({ mode: 'top' })
  })
  it('后退但没记录 / 当时就在顶部：回顶部', () => {
    expect(planScroll('POP', undefined)).toEqual({ mode: 'top' })
    expect(planScroll('POP', { y: 0, areas: { post: 0 } })).toEqual({ mode: 'top' })
  })
  it('原地替换（REPLACE）：不动', () => {
    expect(planScroll('REPLACE', saved)).toEqual({ mode: 'keep' })
  })
})

describe('恢复的每一帧', () => {
  it('内容够高：一次滚到位', () => {
    expect(restoreStep(1500, 3000, 0)).toBe('apply')
    expect(restoreStep(1500, 1499.5, 0)).toBe('apply')   // Within 1px counts as close enough
  })
  it('内容还没长出来（数据异步加载中）：等，不滚到半截', () => {
    expect(restoreStep(1500, 600, 100)).toBe('wait')
    expect(restoreStep(1500, 0, RESTORE_TIMEOUT - 1)).toBe('wait')
  })
  it('等超时了：滚到能到的最远处', () => {
    expect(restoreStep(1500, 600, RESTORE_TIMEOUT)).toBe('clamp')
  })
  it('目标是顶部：直接到位', () => {
    expect(restoreStep(0, 0, 0)).toBe('apply')
  })
})

describe('返回按钮有没有上一页', () => {
  it('HashRouter 的 idx > 0 才有上一页', () => {
    expect(canGoBack({ idx: 3, key: 'k' })).toBe(true)
    expect(canGoBack({ idx: 0, key: 'k' })).toBe(false)   // The first page opened directly from a push / deep link / cold start
    expect(canGoBack(null)).toBe(false)
    expect(canGoBack({ idx: '2' })).toBe(false)
  })
})

describe('分页缓存（后退时保留已加载的几页）', () => {
  it('存进去取得回来，超时作废', () => {
    clearPagedCache()
    putPagedCache('feed|global', { items: [1, 2, 3], next: 'c3', done: false }, 1000)
    expect(takePagedCache('feed|global', 1000 + 5_000)?.items).toEqual([1, 2, 3])
    expect(takePagedCache('feed|global', 1000 + PAGED_CACHE_TTL + 1)).toBeNull()
    expect(takePagedCache('feed|global', 1000)).toBeNull()   // Expired ones are deleted
  })
  it('不同的数据（全球 / 关注）分开存', () => {
    clearPagedCache()
    putPagedCache('feed|global', { items: ['g'], next: null, done: true })
    putPagedCache('feed|friends', { items: ['f'], next: null, done: true })
    expect(takePagedCache('feed|global')?.items).toEqual(['g'])
    expect(takePagedCache('feed|friends')?.items).toEqual(['f'])
  })
})
