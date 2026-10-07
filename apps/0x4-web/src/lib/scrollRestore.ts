// 滚动位置记忆的纯逻辑（不碰 DOM，方便单测）。接到界面上的是 components/ScrollRestorer.tsx。
// 规则（和系统浏览器 / iOS 导航栈的直觉一致）：
// · 每条历史记录（react-router 的 location.key）各记一份：整页滚动 + 页面里带 data-scroll-key 的独立滚动区
// · 后退 / 前进（POP）回到某条记录：恢复它离开时的位置
// · 新进入（PUSH）：回到顶部
// · 原地替换（REPLACE，清掉路由 state、换个参数）：不动
// · 列表常常是异步加载的：内容还没长到目标高度就先等，等到了一次滚到位，避免停在半截；超时了就尽量靠近

export interface ScrollEntry { y: number; areas: Record<string, number> }
export type NavKind = 'POP' | 'PUSH' | 'REPLACE'
export type Plan = { mode: 'restore'; entry: ScrollEntry } | { mode: 'top' } | { mode: 'keep' }

export const RESTORE_TIMEOUT = 2500
export const SCROLL_MEMORY_MAX = 100

export class ScrollMemory {
  private map = new Map<string, ScrollEntry>()
  constructor(private max = SCROLL_MEMORY_MAX) {}
  get(key: string): ScrollEntry | undefined { return this.map.get(key) }
  private touch(key: string): ScrollEntry {
    let e = this.map.get(key)
    if (e) this.map.delete(key)
    else e = { y: 0, areas: {} }
    this.map.set(key, e)
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
    return e
  }
  saveWindow(key: string, y: number) { this.touch(key).y = Math.max(0, Math.round(y)) }
  saveArea(key: string, area: string, top: number) { this.touch(key).areas[area] = Math.max(0, Math.round(top)) }
  size() { return this.map.size }
  toJSON(): [string, ScrollEntry][] { return [...this.map.entries()] }
  static from(data: unknown, max = SCROLL_MEMORY_MAX): ScrollMemory {
    const m = new ScrollMemory(max)
    if (!Array.isArray(data)) return m
    for (const row of data) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue
      const e = row[1] as Partial<ScrollEntry> | null
      if (!e || typeof e.y !== 'number' || !Number.isFinite(e.y)) continue
      m.saveWindow(row[0], e.y)
      if (e.areas && typeof e.areas === 'object') for (const [k, v] of Object.entries(e.areas)) if (typeof v === 'number' && Number.isFinite(v)) m.saveArea(row[0], k, v)
    }
    return m
  }
}

/** 进到一条历史记录时该怎么滚 */
export function planScroll(nav: NavKind, saved: ScrollEntry | undefined): Plan {
  if (nav === 'REPLACE') return { mode: 'keep' }
  if (nav === 'POP' && saved && (saved.y > 0 || Object.values(saved.areas).some((v) => v > 0))) return { mode: 'restore', entry: saved }
  // 后退回来但当时就在顶部（或者没记录，比如冷启动后按了返回）：回顶部
  return { mode: 'top' }
}

/**
 * 恢复的某一帧：目标位置现在能不能到。
 * · max = 当前内容能滚到的最大位置（scrollHeight - clientHeight）
 * · 能到 → apply；还不能到、没超时 → wait；超时 → clamp（滚到能到的最远处，别停在顶部）
 */
export function restoreStep(target: number, max: number, elapsed: number, timeout = RESTORE_TIMEOUT): 'apply' | 'wait' | 'clamp' {
  if (target <= 0 || max >= target - 1) return 'apply'
  return elapsed >= timeout ? 'clamp' : 'wait'
}
