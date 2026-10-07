// 名字 / 昵称规则（2026-09-28 goat 定）：只允许汉字、英文字母、数字；按宽度算，一个汉字 2、字母数字 1，合计 ≤ 16
import { describe, expect, it } from 'vitest'
import { nameError, nameWidth } from './names'

describe('名字规则', () => {
  it('正常的名字都能用', () => {
    for (const ok of ['夜行者', '一二三四五六七八', 'abcdefghijklmnop', 'DrNerd', 'Zalien4200', '小猫cat123', '我的小精灵']) expect(nameError(ok), ok).toBeNull()
  })
  it('长度按宽度算：最多 8 个汉字或 16 个字母数字', () => {
    expect(nameWidth('一二三四五六七八')).toBe(16)
    expect(nameError('一二三四五六七八九')).not.toBeNull()
    expect(nameError('abcdefghijklmnopq')).not.toBeNull()
    expect(nameError('一二三四五六七ab')).toBeNull()   // 14 + 2 = 16
    expect(nameError('一二三四五六七abc')).not.toBeNull()
  })
  it('空格、符号、表情都不行（含注入和冒充常用的写法）', () => {
    for (const bad of ['DR.Nerd', 'Moon Boy', '<img src=x onerror=alert(1)>', 'a"b', "a'b", 'a&b', '小猫😺', '✓Admin', '官方·客服', '0x4_team',
      'abc‮def',   // 让文字倒着显示的控制符
      'ad​min',    // 看不见的零宽字符
      'ＡＤＭＩＮ',       // 全角字母，看起来像 ADMIN
      '１２３']) expect(nameError(bad), JSON.stringify(bad)).not.toBeNull()
  })
  it('空的不行；昵称的提示说「昵称」', () => {
    expect(nameError('')).not.toBeNull()
    expect(nameError('a b', true)).toMatch(/昵称/)
    expect(nameError('a b')).toMatch(/名字/)
  })
})
