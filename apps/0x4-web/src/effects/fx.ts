// 直播间用的特效开关（2026-10-02）：把设置套到主播的摄像头上。
// · 开摄像头时：processorForCamera() 给一个已经按设置配好的处理器（没开特效就不给），画面一开始就是处理过的。
// · 直播中改设置：applyFx(轨道, 设置)——已经在处理就只改参数；从「全关」变成「有特效」就挂上处理器；全关了就摘掉。
// · 处理器代码（含识别引擎、three.js）按需加载，没开特效的主播和观众都不加载。
import type { LocalVideoTrack } from 'livekit-client'
import { fxActive, loadFx, type FxSettings } from './settings'
import type { FxProcessor, FxStatus } from './processor'

let current: FxProcessor | null = null
const listeners = new Set<(s: FxStatus) => void>()
export function onFxStatus(fn: (s: FxStatus) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
const emit = (s: FxStatus) => listeners.forEach((fn) => fn(s))

async function make(s: FxSettings): Promise<FxProcessor> {
  const { FxProcessor } = await import('./processor')
  const p = new FxProcessor(s)
  p.onStatus = emit
  current = p
  return p
}

/** 开摄像头时带上：本机保存的设置里有特效就给处理器，没有给 undefined */
export async function processorForCamera(): Promise<FxProcessor | undefined> {
  const s = loadFx()
  return fxActive(s) ? make(s) : undefined
}

/** 直播中改设置 */
export async function applyFx(track: LocalVideoTrack | undefined, s: FxSettings) {
  if (!track) return
  const p = track.getProcessor() as FxProcessor | undefined
  if (fxActive(s)) {
    if (p && p === current) { p.update(s); return }
    await track.setProcessor(await make(s))
  } else if (p) {
    await track.stopProcessor()
    current = null
  }
}

export const fxStatus = (): FxStatus | null => current?.status ?? null
