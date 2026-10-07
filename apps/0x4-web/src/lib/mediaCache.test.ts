// Media cache: LRU eviction, oversized files not cached, server-expired files still served from cache, clear
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
    await c.put('d', blob(240))            // 960, under the limit
    expect([...be.map.keys()].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(await c.get('a')).not.toBeNull() // a was just used
    await c.put('e', blob(240))            // 1200 → evict least-recently-used b
    expect([...be.map.keys()].sort()).toEqual(['a', 'c', 'd', 'e'])
    await c.put('f', blob(240))            // then evict c
    expect([...be.map.keys()].sort()).toEqual(['a', 'd', 'e', 'f'])
    const total = [...be.map.values()].reduce((s, e) => s + e.size, 0)
    expect(total).toBeLessThanOrEqual(1000)
    // Single files over a quarter of the cap are not cached
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
    alive = false                           // Server deleted the file
    const again = await c.fetch('https://api/uploads/x.webp', fetcher)
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([7, 8, 9])
    expect(hits).toBe(1)                    // Server not requested again
    // Never-cached expired file: error
    await expect(c.fetch('https://api/uploads/y.webp', fetcher)).rejects.toThrow('404')
    // Cache gone after the midnight clear
    await c.clear()
    expect(be.map.size).toBe(0)
    await expect(c.fetch('https://api/uploads/x.webp', fetcher)).rejects.toThrow('404')
  })
})
