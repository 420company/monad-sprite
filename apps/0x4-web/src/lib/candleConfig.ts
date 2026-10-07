// Candle-fetch settings (2026-09-29 goat: future candle-API swaps shouldn't need an app update — set it in the admin panel).
// Set on the admin "data sources" page, delivered via the public GET /api/candles/config (switches and order only, no secrets),
// fetched on first candle use after app start, then every 10 minutes; persisted locally and reused on next open; falls back to the last copy or built-in defaults.
// Built-in defaults = the 2026-09-29 launch behavior; unchanged admin settings behave exactly as before.
// Three routes: server = our server channel (data vendor chosen server-side); dexpaprika = direct keyless fast lane (1h candles only); geckoterminal = direct full history.
import { API_BASE } from './env'

export type CandleRoute = 'server' | 'dexpaprika' | 'geckoterminal'
export interface CandleConfig {
  /** Settings version (admin save time); 0 = built-in defaults */
  v: number
  /** Routes for the first-screen fast chart, in order; may be empty */
  fast: CandleRoute[]
  /** Routes for full history, in order; at least one */
  full: CandleRoute[]
  /** Whether the server channel is usable now; null = unknown yet (ask anyway, the server replies enabled:false) */
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

/** Normalize server-delivered settings; null on bad format (don't use it) */
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

/** Current settings (sync): memory → locally saved → built-in defaults. Also kicks off a server refresh check on the side (not awaited) */
export function candleConfig(): CandleConfig {
  if (!current) current = readStored() ?? { ...DEFAULT_CANDLE_CONFIG, fast: [...DEFAULT_CANDLE_CONFIG.fast], full: [...DEFAULT_CANDLE_CONFIG.full] }
  // Tests never hit the network on their own (they call refreshCandleConfig themselves); in production, refresh every 10 minutes of candle use
  if (import.meta.env.MODE !== 'test' && Date.now() - fetchedAt > REFRESH_MS) void refreshCandleConfig()
  return current
}

/**
 * Use this before deciding on "is the server channel on": if a settings fetch is in flight, wait for it
 * (the fetch itself times out in 4s; the current copy is used if it fails).
 * 2026-09-29 goat: blank BTCB on the spot page — the server had just enabled DexPaprika that day, and
 * browsers that had opened web before still held the old settings with ready:false; the page's first candle
 * used those stale settings (fresh ones still in flight), the server channel was skipped, direct calls got
 * rate-limited, and the whole chart went blank
 */
export function freshCandleConfig(): Promise<CandleConfig> {
  const c = candleConfig()
  return pending ?? Promise.resolve(c)
}

/** Fetch settings from the server once; keep the current ones on failure, no error */
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
          // Persist in the server's format; reads go through the same normalization
          try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: c.v, app: { fast: c.fast, full: c.full }, server: { ready: c.serverReady } })) } catch { /* Privacy mode */ }
        }
      }
    } catch { /* Offline / timeout: keep using the last copy */ }
    return candleConfig()
  })().finally(() => { pending = null })
  return pending
}

/** Test only: reset to the never-fetched state */
export function resetCandleConfig() { current = null; fetchedAt = 0; pending = null }
