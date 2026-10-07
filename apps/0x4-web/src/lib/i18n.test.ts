import { describe, expect, it } from 'vitest'
import { systemLang, t, useLang } from './i18n'

describe('多语言', () => {
  it('系统语言识别：港澳台 / Hant 走繁体，其余中文简体，别的英文', () => {
    expect(systemLang(['zh-CN'])).toBe('zh-Hans')
    expect(systemLang(['zh-Hans-CN'])).toBe('zh-Hans')
    expect(systemLang(['zh-TW'])).toBe('zh-Hant')
    expect(systemLang(['zh-HK'])).toBe('zh-Hant')
    expect(systemLang(['zh-Hant-TW'])).toBe('zh-Hant')
    expect(systemLang(['ja-JP', 'zh-CN'])).toBe('zh-Hans')   // Use Chinese when the list contains it
    expect(systemLang(['en-US'])).toBe('en')
    expect(systemLang(['th-TH'])).toBe('en')
    expect(systemLang([])).toBe('en')
  })

  it('简体：原样输出并填占位符', () => {
    useLang.setState({ lang: 'zh-Hans' })
    expect(t('还有 {n} 个', { n: 3 })).toBe('还有 3 个')
    expect(t('没有占位符')).toBe('没有占位符')
  })

  it('英文：查不到翻译时退回简体原文，不会是空白', () => {
    useLang.setState({ lang: 'en' })
    expect(t('一句字典里肯定没有的话 {x}', { x: 1 })).toBe('一句字典里肯定没有的话 1')
    useLang.setState({ lang: 'zh-Hans' })
  })
})
