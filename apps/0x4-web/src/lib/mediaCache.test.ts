// 媒体缓存：按最近使用淘汰（LRU）、超大文件不缓存、服务器文件过期后照样从缓存拿、清空
import { describe, expect, it } from 'vitest'
import { MediaCache, memoryMediaBackend } from './mediaCache'

const blob = (n: number, fill = 1) => new Blob([new Uint8Array(n).fill(fill)])

describe('媒体缓存', () => {
  it('超过上限从最久没用的开始删；读一次算用过', async () => {
    let clock = 0
    const be = memoryMediaBackend()
    const c = new MediaCache(be, 1000, () => ++clock)
    await c.put('a', blob(240))
    await c.put('b', blob(240))
    await c.put('c', blob(240))
    await c.put('d', blob(240))            // 960，没超
    expect([...be.map.keys()].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(await c.get('a')).not.toBeNull() // a 刚用过
    await c.put('e', blob(240))            // 1200 → 删最久没用的 b
    expect([...be.map.keys()].sort()).toEqual(['a', 'c', 'd', 'e'])
    await c.put('f', blob(240))            // 再删 c
    expect([...be.map.keys()].sort()).toEqual(['a', 'd', 'e', 'f'])
    const total = [...be.map.values()].reduce((s, e) => s + e.size, 0)
    expect(total).toBeLessThanOrEqual(1000)
    // 超过上限四分之一的单个文件不缓存
    await c.put('big', blob(251))
    expect(be.map.has('big')).toBe(false)
    expect(await c.get('nope')).toBeNull()
  })

  it('第一次下载并缓存，服务器上过期（404）后照样从缓存拿到原内容', async () => {
    const be = memoryMediaBackend()
    const c = new MediaCache(be, 10_000)
    let alive = true, hits = 0
    const fetcher = async () => { hits++; return alive ? new Response(new Uint8Array([7, 8, 9])) : new Response('gone', { status: 404 }) }
    const first = await c.fetch('https://api/uploads/x.webp', fetcher)
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([7, 8, 9])
    expect(hits).toBe(1)
    alive = false                           // 服务器删了文件
    const again = await c.fetch('https://api/uploads/x.webp', fetcher)
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([7, 8, 9])
    expect(hits).toBe(1)                    // 没再请求服务器
    // 没缓存过的过期文件：报错
    await expect(c.fetch('https://api/uploads/y.webp', fetcher)).rejects.toThrow('404')
    // 零点清空后缓存没了
    await c.clear()
    expect(be.map.size).toBe(0)
    await expect(c.fetch('https://api/uploads/x.webp', fetcher)).rejects.toThrow('404')
  })
})
