// 聊天里一次发多张图 / 视频：选择数量限制、并发上传、宫格排版。群聊和私信共用，纯函数方便测试。

/** 一次最多选几张 */
export const MAX_PICK = 9
/** 同时上传几个文件 */
export const UPLOAD_CONCURRENCY = 3

export type MediaKind = 'image' | 'video'
export const mediaKindOf = (f: { type: string }): MediaKind | null => (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : null)

/** 相册选回来的文件：只留图片 / 视频，超过 9 张只取前 9 张（truncated = 有被丢掉的） */
export function pickMediaFiles<F extends { type: string }>(files: ArrayLike<F> | null | undefined): { files: F[]; truncated: boolean } {
  const all = Array.from(files || []).filter((f) => mediaKindOf(f))
  return { files: all.slice(0, MAX_PICK), truncated: all.length > MAX_PICK }
}

/** 按顺序并发执行，同时最多 limit 个；每项的成功 / 失败分开返回，不因一项失败中断其它 */
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

/** 宫格：气泡最宽 240，格子间距 2，统一正方形 */
export const GRID_MAX_W = 240
export const GRID_GAP = 2

/**
 * 微信式排法：2 张一行两格，3 张一行三格，4 张 2×2，5~9 张 3 列。
 * 返回列数、行数、格子边长（px，取整后总宽不超过 240）和整个宫格的宽高。
 */
export function gridLayout(n: number, maxW = GRID_MAX_W, gap = GRID_GAP) {
  const count = Math.max(0, Math.min(MAX_PICK, Math.floor(n)))
  const cols = count <= 1 ? 1 : count === 2 || count === 4 ? 2 : 3
  const rows = count ? Math.ceil(count / cols) : 0
  const cell = Math.floor((maxW - gap * (cols - 1)) / cols)
  return { cols, rows, cell, width: cols * cell + gap * (cols - 1), height: rows ? rows * cell + gap * (rows - 1) : 0 }
}
