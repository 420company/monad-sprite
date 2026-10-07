// @vitest-environment jsdom
// Post images in lists: thumbnails, legacy posts fall back to originals, grid counts, +N, tap for full size, detail page uses full size
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import PostImages from './PostImages'
import { postImages, type PostImage } from '@/lib/postImage'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = (images: PostImage[], mode?: 'grid' | 'full') => act(() => root.render(createElement(PostImages, { images, mode })))
const imgs = () => [...host.querySelectorAll('img')].map((i) => i.getAttribute('src'))
const id = (n: number) => n.toString(16).padStart(24, '0')

describe('PostImages', () => {
  it('老帖子只有原图：列表里回退显示原图，按 4:3 占位', () => {
    render(postImages({ image: '/files/old.jpg' }))
    expect(imgs()).toEqual(['/files/old.jpg'])
    expect(parseFloat((host.querySelector('button') as HTMLElement).style.aspectRatio)).toBeCloseTo(4 / 3)
  })

  it('新帖子列表显示缩略图，按宽高比占位；点开全屏加载大图', () => {
    render([{ url: '/files/big.webp', thumb: '/files/big_t.webp', w: 1200, h: 1600 }])
    expect(imgs()).toEqual(['/files/big_t.webp'])
    const cell = host.querySelector('button') as HTMLElement
    expect(parseFloat(cell.style.aspectRatio)).toBe(0.75)
    expect(cell.style.width).toBe('210px') // Max 280
    act(() => cell.click())
    const viewer = document.body.querySelector('[role="dialog"]')!
    expect([...viewer.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toContain('/files/big.webp')
  })

  it('只有 url 的新文件名也能找到缩略图', () => {
    render(postImages({ image: `/files/${id(1)}_1600x900.webp` }))
    expect(imgs()).toEqual([`/files/${id(1)}_1600x900_t.webp`])
  })

  it('超过 4 张只显示 4 格，第 4 格叠 +N；点第 4 格从第 4 张开始看', () => {
    render(Array.from({ length: 7 }, (_, i) => ({ url: `/files/${i}.webp`, thumb: `/files/${i}_t.webp` })))
    const cells = host.querySelectorAll('button')
    expect(cells.length).toBe(4)
    expect(cells[3].textContent).toBe('+3')
    act(() => (cells[3] as HTMLElement).click())
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('4 / 7')
  })

  it('详情页显示大图', () => {
    render([{ url: '/files/a.webp', thumb: '/files/a_t.webp', w: 800, h: 600 }, { url: '/files/b.jpg' }], 'full')
    expect(imgs()).toEqual(['/files/a.webp', '/files/b.jpg'])
  })
})
