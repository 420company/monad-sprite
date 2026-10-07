import { describe, expect, it } from 'vitest'
import { normComment, previewComments } from './comments'

const c = (id: string, likes: number, createdAt: number) => ({ id, likes, createdAt })

describe('帖子下面露的评论', () => {
  it('没人点赞：取最新两条', () => {
    expect(previewComments([c('a', 0, 1), c('b', 0, 3), c('d', 0, 2)]).map((x) => x.id)).toEqual(['b', 'd'])
  })
  it('有赞的优先，剩下的位置给最新的', () => {
    expect(previewComments([c('old', 1, 1), c('mid', 0, 2), c('new', 0, 3)]).map((x) => x.id)).toEqual(['old', 'new'])
  })
  it('赞多的排前面；赞一样取新的', () => {
    expect(previewComments([c('a', 2, 1), c('b', 5, 2), c('x', 2, 9)]).map((x) => x.id)).toEqual(['b', 'x'])
  })
  it('同一毫秒同样赞数：按 id 定序，结果稳定', () => {
    const list = [c('a', 0, 5), c('c', 0, 5), c('b', 0, 5)]
    expect(previewComments(list).map((x) => x.id)).toEqual(['c', 'b'])
    expect(previewComments([...list].reverse()).map((x) => x.id)).toEqual(['c', 'b'])
  })
  it('不足两条全给，n 可调，不改原数组', () => {
    const list = [c('a', 0, 1)]
    expect(previewComments(list)).toHaveLength(1)
    expect(previewComments([c('a', 0, 1), c('b', 0, 2), c('d', 0, 3)], 1).map((x) => x.id)).toEqual(['d'])
    const src = [c('a', 0, 1), c('b', 3, 2)]
    previewComments(src)
    expect(src.map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('老服务端的评论没有赞数字段：当 0 处理', () => {
    const n = normComment({ id: 'x', author: 'A', text: 'hi', createdAt: 1 })
    expect(n.likes).toBe(0)
    expect(n.likedByMe).toBe(false)
    expect(n.nickname).toBeNull()
  })
})
