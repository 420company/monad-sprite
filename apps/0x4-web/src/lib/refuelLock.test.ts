// Cross-tab mutual exclusion for auto gas top-up (Codex review P1): with an atomic lock only one executes at a time; browsers without locks never auto-top-up
import { describe, expect, it } from 'vitest'
import { canLockRefuel, withRefuelLock } from './refuelLock'

/** Simulates the browser's Web Locks: ifAvailable returns null immediately when a same-named lock is held */
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
    const b = await withRefuelLock(async () => { runs++ }, nav)   // The first one hasn't finished topping up
    expect(b).toBe(false)
    release()
    expect(await a).toBe(true)
    expect(runs).toBe(1)
    // Control: after the lock is released, another run can execute
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
