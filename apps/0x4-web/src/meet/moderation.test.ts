// @vitest-environment jsdom
// 会议管理前端判断（meet/moderation.ts）：和服务器 meetAuth.ts 同一规则
import { describe, expect, it } from 'vitest'
import { canManage, parseModState, roleIn, speakOk } from './moderation'
import { accessBody, accessOk, DEFAULT_ACCESS } from './access'

const S = { host: 'H', admins: ['A'], muteAll: true, stage: ['S'], hands: [{ address: 'M2', name: 'm2', at: 1 }] }

describe('parseModState', () => {
  it('房间元数据（字符串）和接口返回（对象）都能解析；格式不对返回 null', () => {
    expect(parseModState(JSON.stringify(S))).toEqual(S)
    expect(parseModState(S)).toEqual(S)
    expect(parseModState('not json')).toBeNull()
    expect(parseModState({ admins: [] })).toBeNull()
    expect(parseModState(undefined)).toBeNull()
  })
  it('脏字段被丢掉', () => {
    const r = parseModState({ host: 'H', admins: ['A', 3, ''], muteAll: 'yes', stage: null, hands: [{ address: 'x' }, { nope: 1 }] })
    expect(r).toEqual({ host: 'H', admins: ['A'], muteAll: false, stage: [], hands: [{ address: 'x', name: 'x', at: 0 }] })
  })
})

describe('角色与能否说话', () => {
  it('全员禁言：主持人、管理员、台上的人能说，普通成员不能', () => {
    expect(roleIn(S, 'H')).toBe('host'); expect(roleIn(S, 'A')).toBe('admin'); expect(roleIn(S, 'M')).toBe('member')
    expect(speakOk(S, 'H')).toBe(true); expect(speakOk(S, 'A')).toBe(true); expect(speakOk(S, 'S')).toBe(true)
    expect(speakOk(S, 'M')).toBe(false)
    expect(speakOk({ ...S, muteAll: false }, 'M')).toBe(true)
    expect(speakOk(null, 'M')).toBe(true)   // 还没拿到状态：不拦（服务器令牌才是准的）
  })
  it('管理范围：主持人管所有人；管理员只管成员；谁都不能管自己和主持人', () => {
    expect(canManage(S, 'H', 'A')).toBe(true); expect(canManage(S, 'H', 'M')).toBe(true)
    expect(canManage(S, 'A', 'M')).toBe(true); expect(canManage(S, 'A', 'H')).toBe(false)
    expect(canManage({ ...S, admins: ['A', 'B'] }, 'A', 'B')).toBe(false)
    expect(canManage(S, 'M', 'S')).toBe(false); expect(canManage(S, 'H', 'H')).toBe(false)
  })
})

describe('新建会议的密码选项', () => {
  it('开了密码要 4~32 位；不开就是公开会议', () => {
    expect(accessOk(DEFAULT_ACCESS)).toBe(true)
    expect(accessOk({ pwOn: true, pw: '123', listed: true, lobby: false })).toBe(false)
    expect(accessOk({ pwOn: true, pw: '1234', listed: true, lobby: false })).toBe(true)
    expect(accessBody({ pwOn: true, pw: 'abcd', listed: false, lobby: false })).toEqual({ listed: false, lobby: false, password: 'abcd' })
    expect(accessBody({ pwOn: false, pw: 'abcd', listed: true, lobby: false })).toEqual({ listed: true, lobby: false })
  })
  it('申请进入（2026-10-01 晚 goat 改）：默认关、公开会议默认开、不设密码；打开带 lobby: true，可以和密码叠加', () => {
    expect(DEFAULT_ACCESS).toEqual({ pwOn: false, pw: '', listed: true, lobby: false })
    expect(accessBody({ pwOn: true, pw: 'abcd', listed: true, lobby: true })).toEqual({ listed: true, lobby: true, password: 'abcd' })
    expect(accessBody(DEFAULT_ACCESS)).toEqual({ listed: true, lobby: false })
  })
})
