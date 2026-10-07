// 会议画笔标注的纯逻辑（2026-09-30）：坐标归一化（contain 黑边）、谁能画、消息校验、状态更新、补发分段
import { describe, expect, it } from 'vitest'
import {
  applyAnn, canAnnotate, chunkSync, contentRect, fromNorm, laserAlpha, LASER_FADE_MS, MAX_STROKE_NUMS, pruneLaser, sanitizeAnn,
  SYNC_CHUNK_BYTES, toNorm, type AnnMsg, type Stroke,
} from './annotate'
import { packData, unpackData } from './lk'

describe('contentRect / 坐标归一化', () => {
  it('宽屏容器里放 4:3 画面：左右黑边，内容居中', () => {
    const r = contentRect(1600, 900, 1024, 768)
    expect(r.h).toBeCloseTo(900)
    expect(r.w).toBeCloseTo(1200)
    expect(r.x).toBeCloseTo(200)
    expect(r.y).toBeCloseTo(0)
  })
  it('高容器里放 16:9：上下黑边', () => {
    const r = contentRect(800, 800, 1920, 1080)
    expect(r.w).toBeCloseTo(800)
    expect(r.h).toBeCloseTo(450)
    expect(r.y).toBeCloseTo(175)
  })
  it('视频尺寸还不知道：按整个容器', () => {
    expect(contentRect(500, 300, 0, 0)).toEqual({ x: 0, y: 0, w: 500, h: 300 })
  })
  it('不同窗口大小：同一个画面位置换算出同一个归一化坐标（标注落点一致）', () => {
    const a = contentRect(1600, 900, 1920, 1080)   // 主持人大窗口
    const b = contentRect(700, 600, 1920, 1080)    // 听课人小窗口（上下黑边）
    // 画面正中偏右上的一点
    const [nx, ny] = toNorm(a.x + a.w * 0.7, a.y + a.h * 0.25, a)
    expect([nx, ny]).toEqual([0.7, 0.25])
    const [bx, by] = fromNorm(nx, ny, b)
    expect(toNorm(bx, by, b)).toEqual([0.7, 0.25])
    expect(by).toBeGreaterThan(b.y)   // 落在内容区里，不在黑边上
  })
  it('点在黑边上：夹到内容边缘，保留 4 位小数', () => {
    const r = contentRect(1600, 900, 1024, 768)
    expect(toNorm(50, 450, r)).toEqual([0, 0.5])
    expect(toNorm(r.x + r.w / 3, 10, r)[0]).toBe(0.3333)
  })
})

describe('canAnnotate', () => {
  it('当前共享者和主持人能画，其他人不能', () => {
    expect(canAnnotate('sharer', 'sharer', 'host')).toBe(true)
    expect(canAnnotate('host', 'sharer', 'host')).toBe(true)
    expect(canAnnotate('viewer', 'sharer', 'host')).toBe(false)
    expect(canAnnotate('', 'sharer', 'host')).toBe(false)
    expect(canAnnotate(undefined, 'sharer', 'host')).toBe(false)
    expect(canAnnotate('x', null, null)).toBe(false)
  })
})

describe('sanitizeAnn', () => {
  it('合法消息原样通过', () => {
    const seg = { t: 'ann', k: 'seg', id: 'abc_1', tool: 'pen', color: 'red', pts: [0.1, 0.2, 0.3, 0.4] }
    expect(sanitizeAnn(seg)).toEqual(seg)
    expect(sanitizeAnn({ t: 'ann', k: 'undo' })).toEqual({ t: 'ann', k: 'undo' })
    expect(sanitizeAnn({ t: 'ann', k: 'clear' })).toEqual({ t: 'ann', k: 'clear' })
  })
  it('形状不对、坐标越界、点数奇数、太多点、未知颜色一律丢掉', () => {
    const base = { t: 'ann', k: 'seg', id: 'a', tool: 'pen', color: 'red', pts: [0.1, 0.2] }
    expect(sanitizeAnn({ ...base, pts: [0.1] })).toBeNull()
    expect(sanitizeAnn({ ...base, pts: [0.1, 1.5] })).toBeNull()
    expect(sanitizeAnn({ ...base, pts: [0.1, -0.1] })).toBeNull()
    expect(sanitizeAnn({ ...base, pts: [0.1, NaN] })).toBeNull()
    expect(sanitizeAnn({ ...base, pts: new Array(402).fill(0.5) })).toBeNull()
    expect(sanitizeAnn({ ...base, color: 'blue' })).toBeNull()
    expect(sanitizeAnn({ ...base, tool: 'eraser' })).toBeNull()
    expect(sanitizeAnn({ ...base, id: 'x'.repeat(40) })).toBeNull()
    expect(sanitizeAnn({ ...base, id: 'a b' })).toBeNull()
    expect(sanitizeAnn({ t: 'chat', k: 'seg' })).toBeNull()
    expect(sanitizeAnn({ t: 'ann', k: 'hack' })).toBeNull()
    expect(sanitizeAnn(null)).toBeNull()
    expect(sanitizeAnn({ t: 'ann', k: 'sync', reset: 'yes', strokes: [] })).toBeNull()
    expect(sanitizeAnn({ t: 'ann', k: 'sync', reset: true, strokes: [{ id: 'a', by: 'u', tool: 'pen', color: 'red', pts: [2, 2] }] })).toBeNull()
  })
})

describe('applyAnn', () => {
  const seg = (id: string, pts: number[], tool: 'pen' | 'laser' = 'pen'): AnnMsg => ({ t: 'ann', k: 'seg', id, tool, color: 'red', pts })
  it('分段增量拼成一笔，抬笔后再来的段不接', () => {
    let s: Stroke[] = []
    s = applyAnn(s, seg('a', [0.1, 0.1]), 'u1', 1)
    s = applyAnn(s, seg('a', [0.2, 0.2, 0.3, 0.3]), 'u1', 2)
    expect(s).toHaveLength(1)
    expect(s[0].pts).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3])
    s = applyAnn(s, { t: 'ann', k: 'end', id: 'a' }, 'u1', 3)
    expect(s[0].endAt).toBe(3)
    const after = applyAnn(s, seg('a', [0.9, 0.9]), 'u1', 4)
    expect(after).toBe(s)
  })
  it('别人不能往我这一笔上接（按发送者区分同名编号）', () => {
    let s = applyAnn([], seg('a', [0.1, 0.1]), 'u1', 1)
    s = applyAnn(s, seg('a', [0.5, 0.5]), 'u2', 2)
    expect(s).toHaveLength(2)
    expect(s.find((x) => x.by === 'u1')!.pts).toEqual([0.1, 0.1])
  })
  it('一笔点数封顶', () => {
    let s = applyAnn([], seg('a', new Array(400).fill(0.5)), 'u1', 1)
    for (let i = 0; i < 5; i++) s = applyAnn(s, seg('a', new Array(400).fill(0.5)), 'u1', 1)
    expect(s[0].pts.length).toBe(MAX_STROKE_NUMS)
  })
  it('撤销只撤发送者自己最后一笔画笔；清除清全部', () => {
    let s: Stroke[] = []
    s = applyAnn(s, seg('a', [0.1, 0.1]), 'host', 1)
    s = applyAnn(s, seg('b', [0.2, 0.2]), 'sharer', 1)
    s = applyAnn(s, seg('c', [0.3, 0.3]), 'host', 1)
    s = applyAnn(s, seg('d', [0.4, 0.4], 'laser'), 'host', 1)
    s = applyAnn(s, { t: 'ann', k: 'undo' }, 'host', 2)
    expect(s.map((x) => x.id)).toEqual(['a', 'b', 'd'])
    s = applyAnn(s, { t: 'ann', k: 'undo' }, 'sharer', 2)
    expect(s.map((x) => x.id)).toEqual(['a', 'd'])
    s = applyAnn(s, { t: 'ann', k: 'clear' }, 'sharer', 3)
    expect(s).toEqual([])
  })
  it('补发：reset 先清空，重复的笔画不重复加', () => {
    let s = applyAnn([], seg('old', [0.9, 0.9]), 'x', 1)
    s = applyAnn(s, { t: 'ann', k: 'sync', reset: true, strokes: [{ id: 'a', by: 'u1', tool: 'pen', color: 'red', pts: [0.1, 0.1, 0.2, 0.2] }] }, 'sharer', 5)
    expect(s.map((x) => x.id)).toEqual(['a'])
    s = applyAnn(s, { t: 'ann', k: 'sync', reset: false, strokes: [{ id: 'a', by: 'u1', tool: 'pen', color: 'red', pts: [0.1, 0.1, 0.2, 0.2] }] }, 'sharer', 6)
    expect(s).toHaveLength(1)
  })
})

describe('激光笔', () => {
  it('抬笔后 3 秒淡出、之后被清掉；画笔不受影响', () => {
    const laser: Stroke = { id: 'l', by: 'u', tool: 'laser', color: 'red', pts: [0.1, 0.1], endAt: 1000 }
    const pen: Stroke = { id: 'p', by: 'u', tool: 'pen', color: 'red', pts: [0.1, 0.1], endAt: 1000 }
    expect(laserAlpha(laser, 1000)).toBe(1)
    expect(laserAlpha(laser, 1000 + LASER_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(laserAlpha({ ...laser, endAt: null }, 99999)).toBe(1)
    const list = [laser, pen]
    expect(pruneLaser(list, 2000)).toBe(list)
    expect(pruneLaser(list, 1000 + LASER_FADE_MS + 1)).toEqual([pen])
  })
})

describe('chunkSync / 打包', () => {
  it('只补画笔，按单条上限分段，第一段带 reset', () => {
    const many: Stroke[] = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, by: 'host', tool: 'pen' as const, color: 'yellow' as const, pts: Array.from({ length: 600 }, () => 0.1234), endAt: 1 }))
    many.push({ id: 'laser', by: 'host', tool: 'laser', color: 'red', pts: [0.1, 0.1, 0.2, 0.2], endAt: 1 })
    const msgs = chunkSync(many)
    expect(msgs.length).toBeGreaterThan(1)
    msgs.forEach((m, i) => {
      expect(m.k).toBe('sync')
      if (m.k === 'sync') expect(m.reset).toBe(i === 0)
      expect(packData(m).length).toBeLessThanOrEqual(SYNC_CHUNK_BYTES)
      // 发出去的每一段收端都能通过校验
      expect(sanitizeAnn(unpackData(packData(m)))).not.toBeNull()
    })
    const total = msgs.reduce((n, m) => n + (m.k === 'sync' ? m.strokes.length : 0), 0)
    expect(total).toBe(30)
  })
  it('没有画笔也发一条 reset（让对方清掉旧的）', () => {
    expect(chunkSync([])).toEqual([{ t: 'ann', k: 'sync', reset: true, strokes: [] }])
  })
  it('标注消息走同一条数据通道打包 / 解包', () => {
    const m: AnnMsg = { t: 'ann', k: 'seg', id: 'a1', tool: 'laser', color: 'green', pts: [0.5, 0.25] }
    expect(unpackData(packData(m))).toEqual(m)
  })
})
