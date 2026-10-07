// Send many images / videos at once in chat: pick-count limits, concurrent uploads, grid layout. Shared by groups and DMs; pure functions for easy testing.

/** Max images per pick */
export const MAX_PICK = 9
/** Concurrent uploads */
export const UPLOAD_CONCURRENCY = 3

export type MediaKind = 'image' | 'video'
export const mediaKindOf = (f: { type: string }): MediaKind | null => (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : null)

/** Files from the album picker: images / videos only, first 9 when over 9 (truncated = some were dropped) */
export function pickMediaFiles<F extends { type: string }>(files: ArrayLike<F> | null | undefined): { files: F[]; truncated: boolean } {
  const all = Array.from(files || []).filter((f) => mediaKindOf(f))
  return { files: all.slice(0, MAX_PICK), truncated: all.length > MAX_PICK }
}

/** Run in order with concurrency, at most limit at once; per-item success / failure returned separately — one failure doesn't stop the others */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = { status: 'fulfilled', value: await fn(items[i], i) } } catch (reason) { out[i] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Grid: bubble max 240 wide, 2px cell gaps, uniform squares */
export const GRID_MAX_W = 240
export const GRID_GAP = 2

/**
 * WeChat-style layout: 2 → one row of two, 3 → one row of three, 4 → 2×2, 5–9 → 3 columns.
 * Returns column count, row count, cell side (px, floored so total width ≤ 240), and the whole grid's dimensions.
 */
export function gridLayout(n: number, maxW = GRID_MAX_W, gap = GRID_GAP) {
  const count = Math.max(0, Math.min(MAX_PICK, Math.floor(n)))
  const cols = count <= 1 ? 1 : count === 2 || count === 4 ? 2 : 3
  const rows = count ? Math.ceil(count / cols) : 0
  const cell = Math.floor((maxW - gap * (cols - 1)) / cols)
  return { cols, rows, cell, width: cols * cell + gap * (cols - 1), height: rows ? rows * cell + gap * (rows - 1) : 0 }
}
