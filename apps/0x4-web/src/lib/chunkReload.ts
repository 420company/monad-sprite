// 发新版后，开着的旧页面再去拿旧版本的分包文件会失败（每次发布只保留新文件名）：
// 「TypeError: Failed to fetch dynamically imported module …/MeetingRoom-xxxx.js」（2026-10-02 goat 创建会议时撞上）。
// 遇到这类错误就原地刷新一次拿新版本，地址不变（还在原来要去的会议 / 页面）；30 秒内又失败（比如断网）就不再刷，交给兜底页。

const KEY = '0x4.chunkReload'
const WINDOW_MS = 30_000

/** 是不是「分包文件拿不到」这一类错误（各浏览器措辞不同） */
export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(msg)
}

/** 刷新一次拿新版本；30 秒内已经刷过一次就不刷（返回 false，由调用方显示错误） */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* 存储用不了：照样刷一次 */ }
  location.reload()
  return true
}

// Vite 预加载依赖失败时发这个事件：拦下来直接刷新，不让错误冒到界面上
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => { if (reloadForNewVersion()) e.preventDefault() })
}
