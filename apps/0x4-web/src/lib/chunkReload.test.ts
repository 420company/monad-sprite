// Stale pages can't fetch old chunks after a release (2026-10-02): recognizes each browser's error wording; auto-refreshes at most once per 30 s
import { describe, expect, it, vi } from 'vitest'
import { isChunkError, reloadForNewVersion } from './chunkReload'

describe('分包拿不到时自动刷新', () => {
  it('认得 Chrome / Safari / Firefox 的措辞，别的错误不算', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://420.meme/app/assets/MeetingRoom-DGSnyUfY.js'))).toBe(true)
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkError(new Error('Unable to preload CSS for /app/assets/trade-x.css'))).toBe(true)
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(isChunkError(null)).toBe(false)
  })
  it('30 秒内只刷一次，第二次交给兜底页', () => {
    const reload = vi.fn()
    const mem = new Map<string, string>()
    vi.stubGlobal('location', { reload })
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } })
    expect(reloadForNewVersion()).toBe(true)
    expect(reloadForNewVersion()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
