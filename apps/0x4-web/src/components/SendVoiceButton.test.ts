// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { HOLD_TO_RECORD_MS } from '@/lib/voice'

vi.mock('@/lib/native', () => ({ tap: () => {}, hapticResult: () => {} }))
const { default: SendVoiceButton } = await import('./SendVoiceButton')

// Fake recorder: emits a 30KB chunk of data on stop after start
class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'audio/mp4;codecs=mp4a.40.2'
  state = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_s: unknown, o: { mimeType?: string }) { this.mimeType = o.mimeType || '' }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(30_000)]) }); this.onstop?.() }
}

let root: Root, host: HTMLDivElement
const trackStop = vi.fn()
const props = { canSend: true, onSend: vi.fn(), onVoice: vi.fn() }
const IS_REACT_ACT_ENVIRONMENT = 'IS_REACT_ACT_ENVIRONMENT'

beforeEach(() => {
  ;(globalThis as Record<string, unknown>)[IS_REACT_ACT_ENVIRONMENT] = true
  vi.useFakeTimers()
  props.onSend = vi.fn(); props.onVoice = vi.fn(); props.canSend = true; trackStop.mockClear()
  ;(globalThis as Record<string, unknown>).MediaRecorder = FakeRecorder
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] })) } })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(createElement(SendVoiceButton, { ...props, children: 'send' })))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const btn = () => host.querySelector('button')!
const fire = (type: string, y = 0) => act(() => { btn().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 0, clientY: y })) })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('发送键兼语音键', () => {
  it('短按发送文字，不录音', () => {
    fire('pointerdown'); act(() => { vi.advanceTimersByTime(300) }); fire('pointerup')
    expect(props.onSend).toHaveBeenCalledTimes(1)
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })
  it('输入框为空时短按不做事', () => {
    props.canSend = false
    act(() => root.render(createElement(SendVoiceButton, { ...props, children: 'send' })))
    fire('pointerdown'); fire('pointerup')
    expect(props.onSend).not.toHaveBeenCalled()
  })
  it('按住到阈值开始录音，松开发送语音且不触发文字发送', async () => {
    fire('pointerdown'); act(() => { vi.advanceTimersByTime(HOLD_TO_RECORD_MS) }); await flush()
    expect(document.body.textContent).toContain('松开发送')
    act(() => { vi.advanceTimersByTime(3000) })
    fire('pointerup')
    expect(props.onVoice).toHaveBeenCalledTimes(1)
    expect((props.onVoice.mock.calls[0][0] as Blob).type).toBe('audio/mp4;codecs=mp4a.40.2')
    expect(props.onSend).not.toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalled()
  })
  it('录音中移出按钮松开＝取消', async () => {
    fire('pointerdown'); act(() => { vi.advanceTimersByTime(HOLD_TO_RECORD_MS) }); await flush()
    act(() => { vi.advanceTimersByTime(3000) })
    fire('pointermove', -200)
    expect(document.body.textContent).toContain('松开取消')
    fire('pointerup', -200)
    expect(props.onVoice).not.toHaveBeenCalled()
    expect(props.onSend).not.toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalled()
  })
  it('权限框期间手指已松开：放掉麦克风，不录音', async () => {
    let resolve!: (s: unknown) => void
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    fire('pointerdown'); act(() => { vi.advanceTimersByTime(HOLD_TO_RECORD_MS) })
    fire('pointercancel')
    await act(async () => { resolve({ getTracks: () => [{ stop: trackStop }] }) })
    expect(trackStop).toHaveBeenCalled()
    expect(props.onVoice).not.toHaveBeenCalled()
    expect(props.onSend).not.toHaveBeenCalled()
  })
})
