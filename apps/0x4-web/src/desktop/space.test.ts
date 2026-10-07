// 「空间」外观的背景选择（space.ts）：亮度 → 压暗的换算、该铺哪张图
import { describe, expect, it } from 'vitest'
import { SPACE_WALLS, dimFor, wallSrc } from './space'

describe('空间背景', () => {
  it('暗图压得少、亮图压得多，并且有上下限', () => {
    expect(dimFor(20)).toBe(.12)
    expect(dimFor(70)).toBe(.12)
    expect(dimFor(255)).toBe(.5)
    expect(dimFor(160)).toBeGreaterThan(dimFor(100))
  })
  it('选了自己的图片就用它，没有图片时退回内置第一张', () => {
    expect(wallSrc({ wall: 'custom', customUrl: 'blob:x' })).toBe('blob:x')
    expect(wallSrc({ wall: 'custom', customUrl: null })).toBe(SPACE_WALLS[0].src)
    expect(wallSrc({ wall: 'orbit', customUrl: 'blob:x' })).toBe(SPACE_WALLS.find((w) => w.id === 'orbit')!.src)
  })
})
