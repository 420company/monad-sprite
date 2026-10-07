// @vitest-environment jsdom
// Home top-bar official scrolling announcements (2026-09-29):
// ① With no announcement, the logo keeps showing 0x4 on its right; with one, it shows the title, and the 0x4 page title is left for screen readers
// 2. Tap to open the modal for the full text: title, body, publish time; multiple ones can be flipped through
// 3. HTML in the body and title renders as text — never becomes real tags
// ④ Fetch: use cache within 5 minutes, coalesce concurrent requests; API failures don't throw, the home page still shows 0x4
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { HomeNotice } from '@/lib/homeNotices'

// Modals don't run Web Animations under reduced motion (jsdom has no element.animate); some modules read matchMedia at load time, so it must be installed before import
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
const apiMock = vi.fn()
vi.mock('@/lib/social', async (orig) => ({ ...(await orig<typeof import('@/lib/social')>()), api: (...a: unknown[]) => apiMock(...a) }))

const { HomeBrandView } = await import('./HomeBrand')
const { default: HomeBrand } = await import('./HomeBrand')
const { loadHomeNotices, resetHomeNotices, CACHE_MS } = await import('@/lib/homeNotices')

const notice = (id: number, over: Partial<HomeNotice> = {}): HomeNotice => ({ id, title: `公告标题 ${id}`, body: `公告正文 ${id}\n第二行`, pinned: false, publishedAt: Date.UTC(2026, 8, 29, 4, 0), ...over })

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  resetHomeNotices()
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.querySelectorAll('dialog').forEach((d) => d.remove()); apiMock.mockReset() })
const render = (notices: HomeNotice[]) => act(() => root.render(createElement(HomeBrandView, { notices })))
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const dialogText = () => document.querySelector('dialog')?.textContent || ''

describe('首页顶栏公告', () => {
  it('没有公告：logo 右边显示 0x4，没有公告按钮', () => {
    render([])
    const h1 = host.querySelector('h1')!
    expect(h1.getAttribute('aria-label')).toBe('0x4')   // Screen readers read "0x4"
    expect(h1.classList.contains('brand-wordmark')).toBe(true)   // Pixel wordmark
    expect(h1.textContent).toBe('Øx4')   // The 0 on screen is the slashed pixel Ø
    expect(h1.className).not.toContain('sr-only')
    expect(host.querySelector('.notice-ticker')).toBeNull()
  })

  it('有公告：显示标题，0x4 只留给读屏', () => {
    render([notice(1), notice(2)])
    expect(host.querySelector('h1')!.className).toContain('sr-only')
    const btn = host.querySelector('.notice-ticker') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain('公告标题 1')
    expect(btn.getAttribute('aria-label')).toContain('公告标题 1')
  })

  it('点开弹窗：标题、正文（保留换行）、发布时间；可以翻到下一条', async () => {
    render([notice(1, { pinned: true }), notice(2)])
    await act(async () => { (host.querySelector('.notice-ticker') as HTMLButtonElement).click() })
    await flush()
    const d = document.querySelector('dialog')!
    expect(d.hasAttribute('open')).toBe(true)
    expect(dialogText()).toContain('公告标题 1')
    const body = d.querySelector('.notice-body')!
    expect(body.textContent).toBe('公告正文 1\n第二行')
    expect(body.className).toContain('whitespace-pre-wrap')
    expect(d.querySelector('time')?.getAttribute('dateTime')).toBe(new Date(Date.UTC(2026, 8, 29, 4, 0)).toISOString())
    expect(dialogText()).toContain('已置顶')
    const next = [...d.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '下一条')!
    await act(async () => { next.click() })
    expect(d.querySelector('.notice-body')!.textContent).toBe('公告正文 2\n第二行')
    expect(dialogText()).toContain('2 / 2')
  })

  it('标题和正文里的 HTML 按文字显示，不会变成真的标签', async () => {
    const evil = notice(9, { title: '<b id="t-evil">粗</b>', body: '<img id="evil" src=x onerror="window.__pwned=1"><script id="s-evil">window.__pwned=2</script>' })
    render([evil])
    expect(host.querySelector('#t-evil')).toBeNull()
    expect(host.querySelector('.notice-ticker')!.textContent).toContain('<b id="t-evil">粗</b>')
    await act(async () => { (host.querySelector('.notice-ticker') as HTMLButtonElement).click() })
    await flush()
    const d = document.querySelector('dialog')!
    expect(d.querySelector('#evil')).toBeNull()
    expect(d.querySelector('#s-evil')).toBeNull()
    expect(d.querySelector('.notice-body')!.textContent).toBe(evil.body)
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
  })
})

describe('拉取公告', () => {
  it('进首页拉到公告就显示；接口失败照常显示 0x4', async () => {
    apiMock.mockResolvedValueOnce({ list: [notice(3)] })
    act(() => root.render(createElement(HomeBrand)))
    await flush()
    expect(host.querySelector('.notice-ticker')?.textContent).toContain('公告标题 3')
    expect(apiMock).toHaveBeenCalledWith('/api/home-notices')

    act(() => root.unmount())
    root = createRoot(host)
    resetHomeNotices()
    apiMock.mockRejectedValueOnce(new Error('网络错误'))
    act(() => root.render(createElement(HomeBrand)))
    await flush()
    expect(host.querySelector('.notice-ticker')).toBeNull()
    expect(host.querySelector('h1')!.getAttribute('aria-label')).toBe('0x4')
  })

  it('5 分钟内用缓存；同时进来的请求只发一次；过了 5 分钟重新拉', async () => {
    apiMock.mockResolvedValue({ list: [notice(4)] })
    const t0 = Date.now()
    const [a, b] = await Promise.all([loadHomeNotices(t0), loadHomeNotices(t0)])
    expect(a).toEqual(b)
    expect(apiMock).toHaveBeenCalledTimes(1)
    await loadHomeNotices(Date.now() + CACHE_MS - 1000)
    expect(apiMock).toHaveBeenCalledTimes(1)
    await loadHomeNotices(Date.now() + CACHE_MS + 1000)
    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('缓存过期后接口失败：沿用上次的公告，不清空', async () => {
    apiMock.mockResolvedValueOnce({ list: [notice(5)] })
    await loadHomeNotices()
    apiMock.mockRejectedValueOnce(new Error('网络错误'))
    const l = await loadHomeNotices(Date.now() + CACHE_MS + 1000)
    expect(l.map((n) => n.id)).toEqual([5])
  })
})
