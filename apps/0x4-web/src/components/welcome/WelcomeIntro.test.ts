// @vitest-environment jsdom
// Welcome / unlock page cat-head entrance (2026-09-29 goat: the mosaic reveal clashed with the whole look — changed to drop-in + focus + landing halo with pixel grain)
// ① play fully only once per app open: the second visit to the unlock page (after auto-lock) starts in place, with the T_STILL timeline
// ② OS "reduce motion": never plays
// ③ when playing: drop-in animation, halo, 8 grains, soft ground shadow; when not playing: just the cat-head image
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CatMark, T_FAST, T_STILL, resetIntroSession, useIntroPlay } from './WelcomeIntro'

let root: Root, host: HTMLDivElement
const seen: { play: boolean; tl: unknown }[] = []
function Probe() { const r = useIntroPlay(T_FAST); seen.push(r); return createElement(CatMark, { tl: r.tl, play: r.play }) }
const mount = () => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(createElement(Probe))) }
const unmount = () => { act(() => root.unmount()); host.remove() }

beforeEach(() => { ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; resetIntroSession(); seen.length = 0 })
afterEach(() => { vi.unstubAllGlobals() })

describe('猫头入场', () => {
  it('本次打开 App 第一次进来完整播：落下 + 光晕 + 8 颗颗粒 + 地面淡影', () => {
    mount()
    const cat = host.querySelector('[data-testid="welcome-cat"]')!
    expect(seen.at(-1)).toEqual({ play: true, tl: T_FAST })
    expect(cat.classList.contains('is-dropping')).toBe(true)
    expect(cat.querySelector('.welcome-cat-halo')).not.toBeNull()
    expect(cat.querySelector('.welcome-cat-shadow')).not.toBeNull()
    expect(cat.querySelectorAll('.welcome-cat-sparks i')).toHaveLength(8)
    expect(cat.querySelector('img.welcome-cat-img')).not.toBeNull()
    unmount()
  })

  it('同一次打开 App 第二次进来（被自动锁定后回到解锁页）：不再从头演，猫头直接在位', () => {
    mount(); unmount()
    mount()
    const cat = host.querySelector('[data-testid="welcome-cat"]')!
    expect(seen.at(-1)).toEqual({ play: false, tl: T_STILL })
    expect(cat.classList.contains('is-dropping')).toBe(false)
    expect(cat.querySelector('.welcome-cat-sparks')).toBeNull()
    expect(cat.querySelector('.welcome-cat-halo')).toBeNull()
    expect(cat.querySelector('img.welcome-cat-img')).not.toBeNull()   // The cat head is still there
    unmount()
  })

  it('冷启动（重新打开 App）又会完整播一次', () => {
    mount(); unmount()
    resetIntroSession()
    mount()
    expect(seen.at(-1)!.play).toBe(true)
    unmount()
  })

  it('系统开了「减少动态效果」：第一次也不播', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    mount()
    expect(seen.at(-1)).toEqual({ play: false, tl: T_STILL })
    expect(host.querySelector('.is-dropping')).toBeNull()
    unmount()
  })
})
