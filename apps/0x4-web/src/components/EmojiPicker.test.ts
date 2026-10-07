// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import EmojiPicker, { EMOJI_CATEGORIES, RECENT_KEY, RECENT_MAX, deleteBefore, insertAt, loadRecent, pushRecent, useEmojiInput } from './EmojiPicker'

describe('插入位置', () => {
  it('插在光标处，光标移到表情后面', () => {
    expect(insertAt('你好世界', '😀', 2)).toEqual({ value: '你好😀世界', caret: 4 })
    expect(insertAt('', '👍', 0)).toEqual({ value: '👍', caret: 2 })
    expect(insertAt('abc', '🔥', 3)).toEqual({ value: 'abc🔥', caret: 5 })
  })
  it('有选中文字时替换选区', () => {
    expect(insertAt('abcdef', '🚀', 1, 4)).toEqual({ value: 'a🚀ef', caret: 3 })
  })
  it('越界的光标夹回文字范围内', () => {
    expect(insertAt('ab', '😀', 99)).toEqual({ value: 'ab😀', caret: 4 })
    expect(insertAt('ab', '😀', -3)).toEqual({ value: '😀ab', caret: 2 })
  })
  it('超过长度上限就不插', () => {
    expect(insertAt('abcd', '😀', 4, 4, 5)).toBeNull()
    expect(insertAt('abc', '😀', 3, 3, 5)).toEqual({ value: 'abc😀', caret: 5 })
  })
})

describe('删除键', () => {
  it('一个表情整个删掉，不留半个代理对', () => {
    expect(deleteBefore('ab😀', 4)).toEqual({ value: 'ab', caret: 2 })
    expect(deleteBefore('❤️x', 2)).toEqual({ value: 'x', caret: 0 })
  })
  it('普通字删一个；光标在最前面不动；有选区删选区', () => {
    expect(deleteBefore('你好', 2)).toEqual({ value: '你', caret: 1 })
    expect(deleteBefore('abc', 0)).toEqual({ value: 'abc', caret: 0 })
    expect(deleteBefore('abcdef', 1, 3)).toEqual({ value: 'adef', caret: 1 })
  })
})

describe('最近使用', () => {
  it('新的排最前并去重', () => {
    expect(pushRecent(['😀', '👍', '🔥'], '👍')).toEqual(['👍', '😀', '🔥'])
    expect(pushRecent([], '😀')).toEqual(['😀'])
  })
  it(`最多保留 ${RECENT_MAX} 个，挤掉最旧的`, () => {
    const all = EMOJI_CATEGORIES[0].list.slice(0, RECENT_MAX)
    const next = pushRecent(all, '🐶')
    expect(next).toHaveLength(RECENT_MAX)
    expect(next[0]).toBe('🐶')
    expect(next).not.toContain(all[RECENT_MAX - 1])
  })
  it('存储坏了或不是数组时返回空，不抛错', () => {
    localStorage.setItem(RECENT_KEY, '{oops')
    expect(loadRecent()).toEqual([])
    localStorage.setItem(RECENT_KEY, JSON.stringify({ a: 1 }))
    expect(loadRecent()).toEqual([])
    localStorage.removeItem(RECENT_KEY)
  })
})

describe('表情数据', () => {
  it('每类 40~80 个且类内不重复', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(c.list.length, c.label).toBeGreaterThanOrEqual(40)
      expect(c.list.length, c.label).toBeLessThanOrEqual(80)
      expect(new Set(c.list).size, c.label).toBe(c.list.length)
    }
  })
})

describe('面板接到输入框', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.removeItem(RECENT_KEY)
    host = document.createElement('div'); document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  function Harness() {
    const [text, setText] = useState('你好世界')
    const e = useEmojiInput<HTMLTextAreaElement>(text, setText)
    return createElement('div', null,
      createElement('textarea', { ...e.fieldProps, value: text, onChange: (ev: { target: { value: string } }) => setText(ev.target.value), 'data-testid': 'field' }),
      createElement('button', { onClick: e.toggle, 'data-testid': 'toggle' }, 'emoji'),
      e.open && createElement(EmojiPicker, { onPick: e.pick, onBackspace: e.backspace }))
  }

  it('点笑脸：输入框失焦、面板出来；点表情插到原光标处并记进最近使用；再点输入框面板收起', () => {
    act(() => root.render(createElement(Harness)))
    const field = host.querySelector('textarea')!
    act(() => { field.focus(); field.setSelectionRange(2, 2); field.dispatchEvent(new Event('select', { bubbles: true })) })
    act(() => (host.querySelector('[data-testid=toggle]') as HTMLButtonElement).click())
    expect(document.activeElement).not.toBe(field)
    // jsdom 的选择器引擎认不出属性值里的表情，按 aria-label 手动找
    const btn = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '👍') as HTMLButtonElement
    expect(btn).toBeTruthy()
    act(() => btn.click())
    expect(field.value).toBe('你好👍世界')
    act(() => btn.click())
    expect(field.value).toBe('你好👍👍世界')
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(['👍'])
    // 删除键删一个整表情
    act(() => (host.querySelector('button[aria-label="删除"]') as HTMLButtonElement).click())
    expect(field.value).toBe('你好👍世界')
    act(() => field.focus())
    expect(host.querySelector('[role=tablist]')).toBeNull()
  })
})
