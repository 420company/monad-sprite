// @vitest-environment jsdom
// 扫码登录的公共电脑（仅本次登录）没人在用就自动退出（2026-10-01 goat）：
// 30 分钟没有活动弹窗「是否停止当前服务？」，2 分钟内不点自动退出；点、按键、滚轮、触摸、自己说话、发消息、送礼都算在用，只是开着看 / 听不算
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GRACE_MS, IDLE_MS, PING_GAP_MS, idleStage, reportActivity, shouldPing, watchIdle, type ActivityKind, type IdleStage } from './qrIdle'

afterEach(() => { vi.useRealTimers() })

function setup() {
  vi.useFakeTimers()
  let now = 0
  const target = new EventTarget()
  const ping = vi.fn(async (_k: ActivityKind) => {})
  const stages: IdleStage[] = []
  const w = watchIdle({ onStage: (s) => stages.push(s), ping, now: () => now, target, tickMs: 1000 })
  const at = (ms: number) => { now = ms; vi.advanceTimersByTime(1000) }
  return { w, target, ping, stages, at, set: (ms: number) => { now = ms }, get now() { return now } }
}

describe('扫码登录（仅本次）自动退出', () => {
  it('阶段：30 分钟内正常；满 30 分钟弹窗；再过 2 分钟退出', () => {
    expect(IDLE_MS).toBe(30 * 60_000); expect(GRACE_MS).toBe(2 * 60_000)
    expect(idleStage(IDLE_MS - 1, 0)).toBe('ok')
    expect(idleStage(IDLE_MS, 0)).toBe('warn')
    expect(idleStage(IDLE_MS + GRACE_MS - 1, 0)).toBe('warn')
    expect(idleStage(IDLE_MS + GRACE_MS, 0)).toBe('out')
  })

  it('告诉服务器「还在用」最多一分钟一次', () => {
    expect(shouldPing(PING_GAP_MS - 1, 0)).toBe(false)
    expect(shouldPing(PING_GAP_MS, 0)).toBe(true)
  })

  it('页面开着但没人碰：30 分钟弹窗，2 分钟没点自动退出；定时器本身不会去续', () => {
    const s = setup()
    s.at(IDLE_MS - 1000); expect(s.stages).toEqual([])
    s.at(IDLE_MS); expect(s.stages).toEqual(['warn'])
    s.at(IDLE_MS + GRACE_MS); expect(s.stages).toEqual(['warn', 'out'])
    expect(s.ping).not.toHaveBeenCalled()
    s.target.dispatchEvent(new Event('pointerdown'))   // 退出以后再动也不复活
    reportActivity('speak')
    expect(s.stages).toEqual(['warn', 'out'])
    s.w.stop()
  })

  it('弹窗出来后，只有点「继续使用」才续：随手碰一下鼠标、键盘不算（人可能已经走了）', () => {
    const s = setup()
    s.at(IDLE_MS); expect(s.stages).toEqual(['warn'])
    s.target.dispatchEvent(new Event('pointerdown'))
    s.target.dispatchEvent(new Event('keydown'))
    expect(s.stages).toEqual(['warn'])
    s.w.touch('input')   // 「继续使用」
    expect(s.stages).toEqual(['warn', 'ok'])
    expect(s.ping).toHaveBeenCalledWith('input')
    // 续上以后重新计 30 分钟
    s.at(s.now + IDLE_MS - 1000); expect(s.stages).toEqual(['warn', 'ok'])
    s.w.stop()
  })

  it('真实操作（点、按键、滚轮、触摸）续期并告诉服务器；鼠标移动不算', () => {
    const s = setup()
    s.set(PING_GAP_MS + 5)
    s.target.dispatchEvent(new Event('pointermove'))
    expect(s.ping).not.toHaveBeenCalled()
    s.target.dispatchEvent(new Event('keydown'))
    expect(s.ping).toHaveBeenCalledTimes(1)
    s.target.dispatchEvent(new Event('wheel'))          // 一分钟内再动：本地续期，不再发请求
    expect(s.ping).toHaveBeenCalledTimes(1)
    s.w.stop()
  })

  it('自己在说话、发消息、送礼都算在用：带上活动类型告诉服务器；一直在讲话的人不会被弹窗', () => {
    const s = setup()
    for (const [i, kind] of (['speak', 'chat', 'gift'] as const).entries()) {
      s.set((i + 1) * (PING_GAP_MS + 1))
      reportActivity(kind)
      expect(s.ping).toHaveBeenLastCalledWith(kind)
    }
    // 讲了一个小时话，一次都没碰电脑：每 20 秒报一次「在说话」，不弹窗
    const start = s.now
    for (let t = 20_000; t <= 60 * 60_000; t += 20_000) { s.at(start + t); reportActivity('speak') }
    expect(s.stages).toEqual([])
    s.w.stop()
  })

  it('没有在盯（插件登录、信任的电脑）时，报活动什么都不做', () => {
    const s = setup()
    s.w.stop()
    expect(() => reportActivity('chat')).not.toThrow()
    expect(s.ping).not.toHaveBeenCalled()
  })
})
