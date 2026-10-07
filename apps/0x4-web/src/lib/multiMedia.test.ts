// 多图发送：宫格排版、最多 9 张、并发上传上限
import { describe, expect, it } from 'vitest'
import { gridLayout, mapLimit, MAX_PICK, pickMediaFiles } from './multiMedia'

describe('宫格排版', () => {
  it('2 张一行两格，3 张一行三格，4 张 2×2，5~9 张 3 列', () => {
    const shape = (n: number) => { const l = gridLayout(n); return [l.cols, l.rows] }
    expect(shape(2)).toEqual([2, 1])
    expect(shape(3)).toEqual([3, 1])
    expect(shape(4)).toEqual([2, 2])
    expect(shape(5)).toEqual([3, 2])
    expect(shape(6)).toEqual([3, 2])
    expect(shape(7)).toEqual([3, 3])
    expect(shape(9)).toEqual([3, 3])
  })

  it('正方形格子，间距 2，总宽不超过 240', () => {
    for (let n = 2; n <= 9; n++) {
      const l = gridLayout(n)
      expect(l.width).toBeLessThanOrEqual(240)
      expect(l.width).toBe(l.cols * l.cell + 2 * (l.cols - 1))
      expect(l.height).toBe(l.rows * l.cell + 2 * (l.rows - 1))
    }
    expect(gridLayout(2).cell).toBe(119)   // (240 - 2) / 2
    expect(gridLayout(3).cell).toBe(78)    // floor((240 - 4) / 3)
    expect(gridLayout(9).height).toBe(3 * 78 + 4)
  })

  it('超过 9 按 9 算，0 张没有高度', () => {
    expect(gridLayout(12)).toEqual(gridLayout(9))
    expect(gridLayout(0).height).toBe(0)
  })
})

describe('选图', () => {
  const f = (type: string, i = 0) => ({ type, name: `f${i}` })
  it('只留图片和视频', () => {
    expect(pickMediaFiles([f('image/jpeg'), f('application/pdf'), f('video/mp4')]).files.map((x) => x.type)).toEqual(['image/jpeg', 'video/mp4'])
  })
  it('超过 9 张只取前 9 张，并告诉调用方', () => {
    const r = pickMediaFiles(Array.from({ length: 12 }, (_, i) => f('image/png', i)))
    expect(MAX_PICK).toBe(9)
    expect(r.files.map((x) => x.name)).toEqual(Array.from({ length: 9 }, (_, i) => `f${i}`))
    expect(r.truncated).toBe(true)
    expect(pickMediaFiles(Array.from({ length: 9 }, () => f('image/png'))).truncated).toBe(false)
    expect(pickMediaFiles(null).files).toEqual([])
  })
})

describe('并发上传', () => {
  it('同时最多 3 个，结果按原顺序，一个失败不影响其它', async () => {
    let running = 0, peak = 0
    const r = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      running++; peak = Math.max(peak, running)
      await new Promise((ok) => setTimeout(ok, 5 + (x % 3) * 3))
      running--
      if (x === 4) throw new Error('坏了')
      return x * 10
    })
    expect(peak).toBe(3)
    expect(r.map((s) => (s.status === 'fulfilled' ? s.value : 'x'))).toEqual([10, 20, 30, 'x', 50, 60, 70])
  })
})
