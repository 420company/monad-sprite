// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GiftSound, type AudioLike } from './sound'
import { GiftFxEngine, FX_MS, type GiftFxGift } from './engine'

/** Fake player: counts play calls, manually triggers ended */
class FakeAudio implements AudioLike {
  src = ''; volume = 1; currentTime = 0; preload = ''
  plays = 0
  private fns: Record<string, (() => void)[]> = {}
  play() { this.plays++; return Promise.resolve() }
  pause() { /* None */ }
  addEventListener(type: 'ended' | 'error', fn: () => void) { (this.fns[type] ??= []).push(fn) }
  end() { for (const f of this.fns.ended || []) f() }
}
function mkSound(canAutoplay = true) {
  const made: FakeAudio[] = []
  let on = true
  const s = new GiftSound({ create: () => { const a = new FakeAudio(); made.push(a); return a }, canAutoplay: () => canAutoplay, store: { get: () => on, set: (v) => { on = v } } })
  return { s, made }
}
const HACHIMI = '/files/gift-hachimi.mp3'

describe('礼物音效：同一时刻只播一遍', () => {
  it('连送 10 次、20 次只开始播 1 次', () => {
    const { s, made } = mkSound()
    for (let i = 0; i < 10; i++) s.play(HACHIMI)
    expect(s.starts).toBe(1)
    for (let i = 0; i < 10; i++) s.play(HACHIMI)
    expect(s.starts).toBe(1)
    expect(made).toHaveLength(1)          // The file loads only once
    expect(made[0].plays).toBe(1)
    expect(made[0].volume).toBe(0.6)      // Default 60%
  })
  it('播完之后再送会再播；正在播期间送的不补播', () => {
    const { s, made } = mkSound()
    s.play(HACHIMI); s.play(HACHIMI); s.play(HACHIMI)
    made[0].end()
    expect(s.isPlaying(HACHIMI)).toBe(false)
    expect(s.starts).toBe(1)              // No auto-catch-up after playback
    s.play(HACHIMI)
    expect(s.starts).toBe(2)
    expect(made).toHaveLength(1)          // Still the same cached player
  })
  it('两个不同音效互不影响', () => {
    const { s, made } = mkSound()
    s.play(HACHIMI); s.play('/files/other.mp3'); s.play(HACHIMI); s.play('/files/other.mp3')
    expect(s.starts).toBe(2)
    expect(made).toHaveLength(2)
  })
  it('用户还没点过页面：不出声、不报错，之后能正常播', () => {
    const blocked = mkSound(false)
    expect(blocked.s.play(HACHIMI)).toBe(false)
    expect(blocked.s.starts).toBe(0)
  })
  it('浏览器拒绝播放（play 被 reject）：静默，下次还能再试', async () => {
    const { s, made } = mkSound()
    s.play(HACHIMI)
    made[0].play = () => Promise.reject(new Error('NotAllowedError'))
    made[0].end()
    s.play(HACHIMI)
    await Promise.resolve(); await Promise.resolve()
    expect(s.isPlaying(HACHIMI)).toBe(false)
  })
  it('关掉「礼物音效」开关：不播', () => {
    const { s } = mkSound()
    s.setEnabled(false)
    expect(s.play(HACHIMI)).toBe(false)
    expect(s.starts).toBe(0)
  })
  it('页面隐藏：停掉，回来不补播', () => {
    const { s } = mkSound()
    s.play(HACHIMI)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(s.isPlaying(HACHIMI)).toBe(false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(s.starts).toBe(1)
  })
})

const gift = (id: string, fx: string, extra: Partial<GiftFxGift> = {}): GiftFxGift => ({ id, nameZh: id, nameEn: id, icon: `/files/gift-${id}.webp`, fx, ...extra })

describe('礼物动画引擎', () => {
  let box: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    box = document.createElement('div'); document.body.appendChild(box)
  })
  afterEach(() => { vi.useRealTimers(); box.remove() })

  it('哈基米连送 20 次：只有一场币雨，计数 ×20，音效只开始 1 次；播完 DOM 全部清掉', () => {
    const { s } = mkSound()
    const e = new GiftFxEngine(box, { sound: s, reducedMotion: false, lowEnd: false })
    const g = gift('hachimi', 'coinrain', { sound: HACHIMI })
    for (let i = 0; i < 20; i++) e.play({ gift: g, from: { id: `u${i % 3}`, nickname: 'x' } })
    expect(e.rainCount).toBe(20)
    expect(box.querySelectorAll('.gfx-combo')).toHaveLength(1)
    expect(box.querySelector('.gfx-combo')!.textContent).toContain('×20')
    expect(box.querySelectorAll('.gfx-coin').length).toBeLessThanOrEqual(24)   // Coin count capped
    expect(s.starts).toBe(1)
    vi.advanceTimersByTime(FX_MS.coinrain + 5000)
    expect(e.rainCount).toBe(0)
    expect(e.stage.childElementCount).toBe(0)
    e.destroy()
  })
  it('币雨下完以后再送：重新开始一场', () => {
    const e = new GiftFxEngine(box, { sound: null, reducedMotion: false, lowEnd: false })
    const g = gift('hachimi', 'coinrain')
    e.play({ gift: g })
    vi.advanceTimersByTime(FX_MS.coinrain + 5000)
    e.play({ gift: g })
    expect(e.rainCount).toBe(1)
    e.destroy()
  })
  it('两个不同礼物同时来：币雨和排队的大效果互不影响', () => {
    const e = new GiftFxEngine(box, { sound: null, reducedMotion: false, lowEnd: false })
    e.play({ gift: gift('hachimi', 'coinrain') })
    e.play({ gift: gift('rocket', 'rocket') })
    e.play({ gift: gift('supercar', 'car') })
    expect(e.rainCount).toBe(1)
    expect(box.querySelectorAll('.gfx-rocket')).toHaveLength(1)
    expect(e.pending).toBe(2)             // The sports car queues behind the rocket
    vi.advanceTimersByTime(FX_MS.rocket + 10)
    expect(box.querySelectorAll('.gfx-car')).toHaveLength(1)
    vi.advanceTimersByTime(FX_MS.car + 5000)
    expect(e.pending).toBe(0)
    expect(e.stage.childElementCount).toBe(0)
    e.destroy()
  })
  it('同一个人连送同一个大礼物：合并成 ×N，不排一长队', () => {
    const e = new GiftFxEngine(box, { sound: null, reducedMotion: false, lowEnd: false })
    const g = gift('yacht', 'yacht')
    e.play({ gift: g, from: { id: 'a', nickname: 'A' } })          // The first one starts playing immediately
    for (let i = 0; i < 9; i++) e.play({ gift: g, from: { id: 'a', nickname: 'A' } })
    expect(e.pending).toBe(2)
    vi.advanceTimersByTime(FX_MS.yacht + 10)
    expect(box.querySelector('.gfx-cap b')!.textContent).toBe('×9')
    e.destroy()
  })
  it('减少动态效果：只显示静态图和说明', () => {
    const e = new GiftFxEngine(box, { sound: null, reducedMotion: true })
    e.play({ gift: gift('fireworks', 'fireworks') })
    expect(box.querySelector('.gfx-still')).not.toBeNull()
    expect(box.querySelector('canvas')).toBeNull()
    e.destroy()
  })
  it('没有图标的礼物用通用礼盒图，不用 emoji', () => {
    const e = new GiftFxEngine(box, { sound: null, reducedMotion: false })
    e.play({ gift: gift('new', 'pop', { icon: null }) })
    const src = [...box.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(src).toContain('/files/gift-giftbox.webp')
    expect(box.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    e.destroy()
  })
  it('页面隐藏：全部停掉清空，回来不补播', () => {
    const e = new GiftFxEngine(box, { sound: null, reducedMotion: false })
    e.play({ gift: gift('rocket', 'rocket') })
    e.play({ gift: gift('supercar', 'car') })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(e.pending).toBe(0)
    expect(e.stage.childElementCount).toBe(0)
    e.play({ gift: gift('rocket', 'rocket') })    // Ones arriving while hidden don't play either
    expect(e.stage.childElementCount).toBe(0)
    e.destroy()
  })
})
