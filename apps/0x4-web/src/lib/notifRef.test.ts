import { describe, expect, it } from 'vitest'
import { pathForRef } from './notifRef'

describe('pathForRef', () => {
  it('认得的 ref 跳到对应页面', () => {
    expect(pathForRef('dm:AbC123')).toBe('/dm/AbC123')
    expect(pathForRef('live:rAbc123')).toBe('/room/rAbc123')
    expect(pathForRef('meet:abc-defg-hij')).toBe('/meet/abc-defg-hij')
    expect(pathForRef('group:g_1')).toBe('/g/g_1')
    expect(pathForRef('user:0xabc')).toBe('/u/0xabc')
    expect(pathForRef('token:bsc:0xAbC')).toBe('/token/bsc/0xAbC')
    expect(pathForRef('perp:BTC')).toBe('/perp?coin=BTC')
    expect(pathForRef('post:Ab_3-x')).toBe('/post/Ab_3-x')
    expect(pathForRef('ticket:Tk_9')).toBe('/support/Tk_9')
    expect(pathForRef('announcement:12')).toBe('/official')
    expect(pathForRef('official')).toBe('/official')
  })
  it('认不出的去通知中心', () => {
    for (const r of [null, undefined, '', 'fly:', 'room:9', 'post:', 'dm:', 'nocolon', 'token:bsc', 'token:bsc:', 'token::0x1', 'ticket:', 'announcement:', 'officials']) expect(pathForRef(r)).toBe('/notifications')
  })
  it('id 里的特殊字符会被转义，不能拼出别的路径', () => {
    expect(pathForRef('dm:../settings')).toBe('/dm/..%2Fsettings')
  })
})

describe('申请加入通知直接打开入群申请（2026-10-03）', () => {
  it('join_request 的群通知带 ?requests=1，别的类型不带', async () => {
    const { pathForNotif } = await import('./notifRef')
    expect(pathForNotif({ type: 'join_request', ref: 'group:abc' })).toBe('/g/abc?requests=1')
    expect(pathForNotif({ type: 'join_approved', ref: 'group:abc' })).toBe('/g/abc')
    expect(pathForNotif({ type: 'join_request', ref: null })).toBe('/notifications')
  })
})

describe('小精灵通知（2026-10-04）', () => {
  it('fly:<id> 和 fly:<id>:daystop 都跳小精灵详情', () => {
    expect(pathForRef('fly:abc123')).toBe('/fly/abc123')
    expect(pathForRef('fly:abc123:daystop')).toBe('/fly/abc123')
  })
})
