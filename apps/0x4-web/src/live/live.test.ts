// @vitest-environment jsdom
// Live overhaul (2026-09-30) frontend pure functions: PK score-bar ratio, countdown, guest 15-second popup, badge tiers, share links
import { describe, expect, it } from 'vitest'
import { mmss, pkRatio } from './pk'
import { GUEST_FREE_MS, guestGateOpen } from './guest'
import { badgeTier, enterTier } from './img'
import { shareUrl, xIntentUrl } from './share'

describe('PK 比分条', () => {
  it('两边都是 0 各一半，一边独大也至少留 8%', () => {
    expect(pkRatio(0, 0)).toBe(0.5)
    expect(pkRatio(3, 1)).toBe(0.75)
    expect(pkRatio(1000, 0)).toBe(0.92)
    expect(pkRatio(0, 1000)).toBe(0.08)
  })
  it('倒计时 mm:ss，不会出负数', () => {
    expect(mmss(260_000)).toBe('4:20')
    expect(mmss(59_001)).toBe('1:00')
    expect(mmss(-5)).toBe('0:00')
  })
})

describe('游客 15 秒', () => {
  it('没登录满 15 秒弹，登录了不弹', () => {
    expect(GUEST_FREE_MS).toBe(15_000)
    expect(guestGateOpen(14_999, false)).toBe(false)
    expect(guestGateOpen(15_000, false)).toBe(true)
    expect(guestGateOpen(3_600_000, false)).toBe(true)
    expect(guestGateOpen(60_000, true)).toBe(false)
  })
})

describe('等级徽章', () => {
  it('六档：1–9 / 10–19 / 20–29 / 30–39 / 40–49 / 50；进场特效 10 / 25 / 40', () => {
    expect([1, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50].map(badgeTier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6])
    expect([9, 10, 24, 25, 39, 40, 50].map(enterTier)).toEqual([0, 10, 10, 25, 25, 40, 40])
  })
})

describe('分享链接', () => {
  it('直播 / 会议链接，发到 X 的地址文案和链接都编码', () => {
    expect(shareUrl('live', 'rAbc')).toMatch(/\/live\/rAbc(\?l=en)?$/)
    expect(shareUrl('meet', 'abc-defg-hij')).toMatch(/\/meet\/abc-defg-hij(\?l=en)?$/)
    const u = new URL(xIntentUrl('今晚聊 & 直播', 'https://app.420.meme/live/rAbc'))
    expect(u.origin).toBe('https://x.com')
    expect(u.searchParams.get('text')).toBe('今晚聊 & 直播')
    expect(u.searchParams.get('url')).toBe('https://app.420.meme/live/rAbc')
  })
})
