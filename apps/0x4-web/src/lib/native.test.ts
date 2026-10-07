// Deep-link parsing: jumping back to the app from the system browser after X authorization relies on this path,
// End-to-end requires tapping the OS confirmation popup on a real device, so only the parsing part is tested here.
import { describe, it, expect } from 'vitest'
import { parseDeepLink } from './native'

describe('parseDeepLink', () => {
  it('把 host 当成路径', () => {
    expect(parseDeepLink('meme.wallet.app://settings?x=linked')).toBe('/settings?x=linked')
    expect(parseDeepLink('meme.wallet.app://community')).toBe('/community')
  })

  it('带子路径与多个参数', () => {
    expect(parseDeepLink('meme.wallet.app://u/ABC123?tab=posts&from=x')).toBe('/u/ABC123?tab=posts&from=x')
  })

  it('根路径', () => {
    expect(parseDeepLink('meme.wallet.app://')).toBe('/')
  })

  it('去掉多余的斜杠', () => {
    expect(parseDeepLink('meme.wallet.app://settings/')).toBe('/settings')
  })

  it('别人的方案与垃圾输入一律忽略', () => {
    expect(parseDeepLink('https://app.420.meme/#/settings')).toBeNull()
    expect(parseDeepLink('othersapp://settings')).toBeNull()
    expect(parseDeepLink('随便写的')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })
})
