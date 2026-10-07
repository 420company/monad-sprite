// 直播特效设置（2026-10-02）：本机存的设置读回来要校验（被改坏、旧版本留下的都按「关」处理），判断「有没有开特效」
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FX_OFF, fxActive, loadFx, saveFx } from './settings'

describe('直播特效设置', () => {
  const mem = new Map<string, string>()
  beforeEach(() => { mem.clear(); vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }) })
  afterEach(() => vi.unstubAllGlobals())

  it('没存过 = 全关；存什么读回什么', () => {
    expect(loadFx()).toEqual(FX_OFF)
    saveFx({ ...FX_OFF, avatar: 'cat', beauty: 0.6, slim: 0.3, bg: 'img:cozy' })
    expect(loadFx()).toEqual({ ...FX_OFF, avatar: 'cat', beauty: 0.6, slim: 0.3, bg: 'img:cozy' })
  })
  it('存坏了的按关处理：未知形象、超范围强度、不存在的背景图、乱码', () => {
    mem.set('0x4.liveFx', JSON.stringify({ avatar: 'robot', beauty: 9, eyes: -2, bg: 'img:../../etc' }))
    expect(loadFx()).toEqual({ ...FX_OFF, beauty: 1 })
    mem.set('0x4.liveFx', '{坏的')
    expect(loadFx()).toEqual(FX_OFF)
  })
  it('有任何一样就算开着特效', () => {
    expect(fxActive(FX_OFF)).toBe(false)
    expect(fxActive({ ...FX_OFF, beauty: 0.1 })).toBe(true)
    expect(fxActive({ ...FX_OFF, bg: 'blur' })).toBe(true)
    expect(fxActive({ ...FX_OFF, avatar: 'cat' })).toBe(true)
    expect(fxActive({ ...FX_OFF, eyes: 0.2 })).toBe(true)
  })
  it('老版本只存了一个美颜强度：当作磨皮，其余三项关', () => {
    mem.set('0x4.liveFx', JSON.stringify({ avatar: 'none', beauty: 0.7, bg: 'blur' }))
    expect(loadFx()).toEqual({ ...FX_OFF, beauty: 0.7, bg: 'blur' })
  })
})
