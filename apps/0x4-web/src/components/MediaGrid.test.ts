// @vitest-environment jsdom
// 多图气泡：格子数与排版、点开全屏看第几张、发送中的进度圈、失败后点感叹号重发、长按不误开大图
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import MediaGrid, { type GridItem } from './MediaGrid'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const items = (n: number, video: number[] = []): GridItem[] => Array.from({ length: n }, (_, i) => ({
  key: `k${i}`, kind: video.includes(i) ? 'video' : 'image',
  thumb: async () => `/t${i}.webp`, full: async () => `/f${i}.webp`,
}))
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const cells = () => [...host.querySelectorAll<HTMLButtonElement>('[data-grid-cell]')]

describe('MediaGrid', () => {
  it('5 张三列，格子正方形 78px，外层带 data-chat-image（气泡去底色）', async () => {
    act(() => root.render(createElement(MediaGrid, { items: items(5) })))
    await flush()
    expect(cells()).toHaveLength(5)
    const grid = host.querySelector('[role=group]') as HTMLElement
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 78px)')
    expect(cells()[0].style.width).toBe('78px'); expect(cells()[0].style.height).toBe('78px')
    expect(host.firstElementChild!.hasAttribute('data-chat-image')).toBe(true)
    expect(cells().map((c) => c.querySelector('img')?.getAttribute('src'))).toEqual(['/t0.webp', '/t1.webp', '/t2.webp', '/t3.webp', '/t4.webp'])
  })

  it('4 张 2×2；视频格显示播放图标', async () => {
    act(() => root.render(createElement(MediaGrid, { items: items(4, [1]) })))
    await flush()
    expect((host.querySelector('[role=group]') as HTMLElement).style.gridTemplateColumns).toBe('repeat(2, 119px)')
    expect(cells()[1].querySelector('video')?.getAttribute('src')).toBe('/t1.webp#t=0.1')
    expect(cells()[1].getAttribute('aria-label')).toBe('播放视频')
  })

  it('点第 3 张打开查看器，显示 3 / 5 和保存按钮', async () => {
    act(() => root.render(createElement(MediaGrid, { items: items(5) })))
    await flush()
    act(() => cells()[2].click())
    await flush()
    const viewer = document.body.querySelector('[aria-label="查看图片"]')!
    expect(viewer.textContent).toContain('3 / 5')
    expect(document.body.querySelector('[aria-label="下载图片"]')).not.toBeNull()
    expect([...viewer.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toContain('/f2.webp')
  })

  it('长按松手后的那次点击不打开大图', async () => {
    const now = vi.spyOn(Date, 'now')
    act(() => root.render(createElement(MediaGrid, { items: items(2) })))
    await flush()
    now.mockReturnValue(1000)
    act(() => { cells()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    now.mockReturnValue(1700)
    act(() => cells()[0].click())
    expect(document.body.querySelector('[aria-label="查看图片"]')).toBeNull()
    now.mockRestore()
  })

  it('发送中：每格一个进度圈，不能点开；失败：感叹号点了重发', async () => {
    const retry = vi.fn()
    act(() => root.render(createElement(MediaGrid, { items: items(3), pending: { progress: [1, 0.4, 0], state: 'uploading' } })))
    await flush()
    const rings = [...host.querySelectorAll('[role=progressbar]')]
    expect(rings.map((r) => r.getAttribute('aria-valuenow'))).toEqual(['40', '0'])   // 传完的那张不再盖进度
    act(() => cells()[1].click())
    expect(document.body.querySelector('[aria-label="查看图片"]')).toBeNull()

    act(() => root.render(createElement(MediaGrid, { items: items(3), pending: { progress: [1, 1, 0.5], state: 'failed' }, onRetry: retry })))
    expect(host.querySelectorAll('[role=progressbar]')).toHaveLength(0)
    act(() => (host.querySelector('[aria-label="发送失败，点击重发"]') as HTMLButtonElement).click())
    expect(retry).toHaveBeenCalledOnce()
  })
})
