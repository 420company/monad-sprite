// K 线取数设置（2026-09-29 goat：以后换 K 线接口不用动 App，后台能设置）。
// 后台「数据源」页设好，服务器公开接口 GET /api/candles/config 下发（只有开关和顺序，没有任何密钥），
// App 启动后第一次用到 K 线时拉一次，之后每 10 分钟再拉；拉到的存本机，下次打开先用上次的；拉不到就用上次的或内置默认。
// 内置默认 = 2026-09-29 上线时的行为，后台不改就和以前完全一样。
// 三条路：server = 我们的服务器通道（数据商在服务器上选）；dexpaprika = 直连免密钥快线（只有 1 小时周期）；geckoterminal = 直连完整历史。
import { API_BASE } from './env'

export type CandleRoute = 'server' | 'dexpaprika' | 'geckoterminal'
export interface CandleConfig {
  /** 设置版本（后台保存时间）；0 = 内置默认 */
  v: number
  /** 首屏快速图按顺序走哪几条路；可以为空 */
  fast: CandleRoute[]
  /** 完整历史按顺序走哪几条路；至少一条 */
  full: CandleRoute[]
  /** 服务器通道现在能不能用；null = 还不知道（照常去问，服务器会回 enabled:false） */
  serverReady: boolean | null
}

export const DEFAULT_CANDLE_CONFIG: Readonly<CandleConfig> = Object.freeze<CandleConfig>({ v: 0, fast: ['server', 'dexpaprika'], full: ['server', 'geckoterminal'], serverReady: null })
const ROUTES: readonly CandleRoute[] = ['server', 'dexpaprika', 'geckoterminal']
const STORE_KEY = '0x4.candleConfig.v1'
const REFRESH_MS = 10 * 60_000
const TIMEOUT_MS = 4000

const list = (v: unknown): CandleRoute[] | null => {
  if (!Array.isArray(v)) return null
  const out: CandleRoute[] = []
  for (const x of v) if ((ROUTES as readonly unknown[]).includes(x) && !out.includes(x as CandleRoute)) out.push(x as CandleRoute)
  return out
}

/** 服务器下发的设置规整一下；格式不对返回 null（不用它） */
export function sanitizeCandleConfig(raw: unknown): CandleConfig | null {
  const d = raw as { v?: unknown; app?: { fast?: unknown; full?: unknown }; server?: { ready?: unknown } } | null
  if (!d || typeof d !== 'object' || !d.app) return null
  const fast = list(d.app.fast), full = list(d.app.full)
  if (!fast || !full || !full.length) return null
  const v = Number(d.v)
  return { v: Number.isFinite(v) && v >= 0 ? v : 0, fast, full, serverReady: typeof d.server?.ready === 'boolean' ? d.server.ready : null }
}

let current: CandleConfig | null = null
let fetchedAt = 0
let pending: Promise<CandleConfig> | null = null

function readStored(): CandleConfig | null {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? sanitizeCandleConfig(JSON.parse(raw)) : null } catch { return null }
}

/** 现在用的设置（同步）：内存 → 本机存的 → 内置默认。顺手检查要不要去服务器拉新的（不等它） */
export function candleConfig(): CandleConfig {
  if (!current) current = readStored() ?? { ...DEFAULT_CANDLE_CONFIG, fast: [...DEFAULT_CANDLE_CONFIG.fast], full: [...DEFAULT_CANDLE_CONFIG.full] }
  // 测试里不自动联网（测试自己调 refreshCandleConfig），线上用到 K 线时满 10 分钟就去拉一次
  if (import.meta.env.MODE !== 'test' && Date.now() - fetchedAt > REFRESH_MS) void refreshCandleConfig()
  return current
}

/**
 * 要按「服务器通道开没开」做决定前用这个：正在从服务器拉设置就等它拉完（拉取本身 4 秒超时，拉不到照用手上的）。
 * ★2026-09-29 goat 现货页 BTCB 空白：服务器当天才开 DexPaprika，之前打开过网页版的浏览器存着 ready:false 的旧设置；
 * 打开页面第一张 K 线用的就是这份旧设置（新设置还在路上），服务器通道被跳过，直连又被限流，整张图空白
 */
export function freshCandleConfig(): Promise<CandleConfig> {
  const c = candleConfig()
  return pending ?? Promise.resolve(c)
}

/** 去服务器拉一次设置；失败就留着现在的，不报错 */
export function refreshCandleConfig(): Promise<CandleConfig> {
  if (pending) return pending
  fetchedAt = Date.now()
  pending = (async () => {
    try {
      const r = await fetch(`${API_BASE}/api/candles/config`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (r.ok) {
        const c = sanitizeCandleConfig(await r.json())
        if (c) {
          current = c
          // 存的时候按服务器的格式存，读回来走同一个规整
          try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: c.v, app: { fast: c.fast, full: c.full }, server: { ready: c.serverReady } })) } catch { /* 无痕模式 */ }
        }
      }
    } catch { /* 断网 / 超时：照用上次的 */ }
    return candleConfig()
  })().finally(() => { pending = null })
  return pending
}

/** 测试用：回到什么都没拉过的状态 */
export function resetCandleConfig() { current = null; fetchedAt = 0; pending = null }
