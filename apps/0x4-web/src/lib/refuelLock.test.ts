// 自动补燃料费跨标签互斥（Codex 复审 P1）：有原子锁时同一时刻只有一个执行；没有锁的浏览器一律不自动补
import { describe, expect, it } from 'vitest'
import { canLockRefuel, withRefuelLock } from './refuelLock'

/** 模拟浏览器的 Web Locks：同名锁被占用时 ifAvailable 立刻给 null */
function fakeNav() {
  const held = new Set<string>()
  return {
    locks: {
      async request(name: string, _o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) {
        if (held.has(name)) return cb(null)
        held.add(name)
        try { await cb({ name }) } finally { held.delete(name) }
      },
    },
  } as unknown as Navigator
}

describe('withRefuelLock', () => {
  it('两个标签同时判断要补：只有一个真的执行（对照：先后执行时两次都能执行）', async () => {
    const nav = fakeNav()
    let runs = 0
    let release!: () => void
    const slow = () => new Promise<void>((r) => { runs++; release = r })
    const a = withRefuelLock(slow, nav)
    const b = await withRefuelLock(async () => { runs++ }, nav)   // 第一个还没补完
    expect(b).toBe(false)
    release()
    expect(await a).toBe(true)
    expect(runs).toBe(1)
    // 对照：锁释放后再来一次可以执行
    expect(await withRefuelLock(async () => { runs++ }, nav)).toBe(true)
    expect(runs).toBe(2)
  })

  it('补充出错也会释放锁，之后还能再补', async () => {
    const nav = fakeNav()
    await expect(withRefuelLock(async () => { throw new Error('签名失败') }, nav)).rejects.toThrow('签名失败')
    expect(await withRefuelLock(async () => {}, nav)).toBe(true)
  })

  it('浏览器没有 Web Locks：不执行、不自动补（阳性对照：有锁时 canLockRefuel 为真）', async () => {
    const bare = {} as Navigator
    let runs = 0
    expect(canLockRefuel(bare)).toBe(false)
    expect(await withRefuelLock(async () => { runs++ }, bare)).toBe(false)
    expect(runs).toBe(0)
    expect(canLockRefuel(fakeNav())).toBe(true)
  })
})
