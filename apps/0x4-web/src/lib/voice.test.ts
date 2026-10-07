import { describe, expect, it } from 'vitest'
import { checkVoice, pickVoiceMime } from './voice'

describe('语音录音格式', () => {
  it('iOS（AAC 与 WebM 都支持）选 AAC，不选 WebM', () => {
    const ios = new Set(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'])
    expect(pickVoiceMime((t) => ios.has(t))).toBe('audio/mp4;codecs=mp4a.40.2')
  })
  it('不支持 AAC 编码的 Chrome 退回 WebM Opus', () => {
    const chrome = new Set(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'])
    expect(pickVoiceMime((t) => chrome.has(t))).toBe('audio/webm;codecs=opus')
  })
  it('都不支持时返回空串，抛错的类型跳过', () => {
    expect(pickVoiceMime(() => false)).toBe('')
    expect(pickVoiceMime((t) => { if (t.includes('mp4')) throw new Error('x'); return t === 'audio/webm' })).toBe('audio/webm')
  })
})

describe('录音校验', () => {
  it('空文件或太短不发', () => {
    expect(checkVoice(0, 5)).toBe('short')
    expect(checkVoice(10_000, 0.3)).toBe('short')
  })
  it('字节数太少判定为没录到声音', () => {
    expect(checkVoice(1_000, 5)).toBe('silent')
    expect(checkVoice(30_000, 5)).toBe('ok')
  })
})
