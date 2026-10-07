// Pure logic for scroll-position memory (no DOM, easy to unit-test). Wired to the UI by components/ScrollRestorer.tsx.
// Rules (matching the intuition of system browsers / the iOS navigation stack):
// · Each history entry (react-router's location.key) remembers its own: whole-page scroll + independent scroll regions with data-scroll-key
// · Back / forward (POP) to an entry: restore where it was left
// · New entry (PUSH): back to top
// · In-place replace (REPLACE, clearing route state, swapping params): don't move
// · Lists are often loaded async: if content hasn't grown to the target height yet, wait and scroll into place once — never stop halfway; on timeout, get as close as possible

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

/** How to scroll when entering a history entry */
export function planScroll(nav: NavKind, saved: ScrollEntry | undefined): Plan {
  if (nav === 'REPLACE') return { mode: 'keep' }
  if (nav === 'POP' && saved && (saved.y > 0 || Object.values(saved.areas).some((v) => v > 0))) return { mode: 'restore', entry: saved }
  // Went back but was at the top anyway (or nothing recorded, e.g. back pressed after a cold start): back to top
  return { mode: 'top' }
}

/**
 * One frame of restoration: can the target position be reached now.
 * · max = the current content's maximum scrollable position (scrollHeight − clientHeight)
 * · reachable → apply; not yet, not timed out → wait; timed out → clamp (scroll to the farthest reachable point, don't stay at the top)
 */
export function restoreStep(target: number, max: number, elapsed: number, timeout = RESTORE_TIMEOUT): 'apply' | 'wait' | 'clamp' {
  if (target <= 0 || max >= target - 1) return 'apply'
  return elapsed >= timeout ? 'clamp' : 'wait'
}
