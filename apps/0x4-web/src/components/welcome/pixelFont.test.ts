import { describe, expect, it } from 'vitest'
import { GLYPH_ROWS, layoutPixelText } from './pixelFont'

describe('像素标语点阵', () => {
  it('两行标语都能排出来，尺寸固定', () => {
    const t = layoutPixelText(['MEME IS', 'EVERYTHING.'])
    expect(t.cols).toBe(63)
    expect(t.rows).toBe(16)
    // 每个方块都在画布范围内，且不重复
    const keys = new Set(t.cells.map(c => `${c.x},${c.y}`))
    expect(keys.size).toBe(t.cells.length)
    for (const c of t.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThan(t.cols)
      expect(c.y - c.line * 9).toBeLessThan(GLYPH_ROWS)
    }
  })
  it('没有的字形直接报错，不静默漏字', () => {
    expect(() => layoutPixelText(['Q'])).toThrow()
  })
})
