// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_TAB_KEY, loadProfileTab, saveProfileTab } from './profileTab'

describe('个人主页标签记忆', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('第一次打开是「动态」', () => { expect(loadProfileTab()).toBe('posts') })
  it('存了什么下次读回什么，键名带 0x4. 前缀', () => {
    saveProfileTab('trades')
    expect(localStorage.getItem('0x4.profileTab')).toBe('trades')
    expect(PROFILE_TAB_KEY.startsWith('0x4.')).toBe(true)
    expect(loadProfileTab()).toBe('trades')
    saveProfileTab('holdings')
    expect(loadProfileTab()).toBe('holdings')
  })
  it('存的值被写坏：回到「动态」', () => {
    localStorage.setItem(PROFILE_TAB_KEY, 'wallet')
    expect(loadProfileTab()).toBe('posts')
  })
  it('存储不可用（隐私模式）：不抛错，回到「动态」', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => saveProfileTab('trades')).not.toThrow()
    expect(loadProfileTab()).toBe('posts')
  })
})
