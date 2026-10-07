import { describe, expect, it } from 'vitest'
import { officialPreview, orderChats } from './chatOrder'

describe('消息列表排序', () => {
  it('其余会话按最后消息时间倒序', () => {
    const rows = [{ key: 'g1', ts: 100 }, { key: 'd1', ts: 300 }, { key: 'g2', ts: 200 }]
    expect(orderChats(rows).map((r) => r.key)).toEqual(['d1', 'g2', 'g1'])
  })
  it('「0x4 官方」置顶：别的会话再新也排在它下面', () => {
    const rows = [{ key: 'd1', ts: 9_999_999 }, { key: 'official', ts: 1, pinned: true }, { key: 'g1', ts: 5_000 }]
    expect(orderChats(rows).map((r) => r.key)).toEqual(['official', 'd1', 'g1'])
  })
  it('不改原数组；时间相同按 key 固定顺序', () => {
    const rows = [{ key: 'b', ts: 1 }, { key: 'a', ts: 1 }]
    expect(orderChats(rows).map((r) => r.key)).toEqual(['a', 'b'])
    expect(rows.map((r) => r.key)).toEqual(['b', 'a'])
  })
})

describe('「0x4 官方」会话摘要', () => {
  it('没有公告就不显示', () => expect(officialPreview([])).toBeNull())
  it('取最新一条：有标题用标题，没标题用正文（换行压成空格）', () => {
    expect(officialPreview([{ title: '维护通知', body: '正文', createdAt: 5 }, { title: null, body: '旧', createdAt: 1 }])).toEqual({ sub: '维护通知', ts: 5 })
    expect(officialPreview([{ title: null, body: '第一行\n第二行', createdAt: 7 }])).toEqual({ sub: '第一行 第二行', ts: 7 })
  })
})
