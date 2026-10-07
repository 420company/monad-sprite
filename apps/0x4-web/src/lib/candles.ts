// DEX spot historical candles. Fetched strictly by "chain + pair address" — never guessed from symbol.
// Contract: docs/CANDLE_DATA_INTERFACE.md. Periods with no trades stay as gaps (no interpolation); unsupported chains return supported:false; network/rate-limit failures throw.
// ★ Which routes to use and in what order is decided by the backend "Data sources" page (src/lib/candleConfig.ts; 2026-09-29 goat: switching candle vendors must not require an app release):
//   loadFastCandles (first-screen fast chart) and loadDexCandles (full history) each try routes in the configured order — first one to deliver wins;
//   routes: server = our server channel (vendors are swapped server-side); dexpaprika = direct keyless fast lane (1h only); geckoterminal = direct full history.
//   default (backend untouched) = first screen tries server then keyless direct; full history goes direct to GeckoTerminal — same as before.
import type { Candle } from './aster'
import { GECKO_NETWORK } from './chains'
import { API_BASE } from './env'
import { candleConfig, freshCandleConfig } from './candleConfig'
import { WEB_SURFACE } from './surface'
import { t } from '@/lib/i18n'

export type DexInterval = '15m' | '1h' | '4h' | '1d'

export interface DexCandles {
  chain: string
  address: string
  pairAddress: string
  interval: DexInterval
  candles: Candle[]
  source: string
  asOf: number
  quoteCurrency: 'USD'
  volumeUnit: 'USD'
  supported: boolean
}

/** DexScreener chain key → GeckoTerminal network id: always via chains.ts GECKO_NETWORK (since 2026-09-25 the Discover lists use it too); chains not in the table are unsupported */
const TIMEFRAME: Record<DexInterval, [string, number]> = { '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] }
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: DexCandles }>()

// ---- Instant open (2026-09-29 goat: opening a token's candles never rendered instantly) ----
// Measured: GeckoTerminal takes ~2.5 s on the first request for a pair (computed on their side), then 0.1–0.2 s right after. Three tricks:
// 1. Cache last-viewed candles on device (localStorage, up to STORE_MAX entries); reopening the same token draws the old chart first, then swaps in fresh data in the background
// 2. Never duplicate an in-flight request for the same pair+interval; when the page opens it attaches to the request already fired on press-down
// 3. Prefetch (press-down on lists, dwell on Discover) has a quota: GeckoTerminal's free API allows 30 req/min per IP,
//    prefetch is capped at PREFETCH_PER_MIN per minute; for one minute after any 429, prefetch pauses so the quota stays for requests the user actually opens
const STORE_KEY = '0x4.candles.v1'
const STORE_MAX = 24
const PREFETCH_PER_MIN = 10
const inflight = new Map<string, Promise<DexCandles>>()
const prefetchTimes: number[] = []
let limitedUntil = 0

type Stored = Record<string, { at: number; value: DexCandles }>
function readStore(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const o = raw ? JSON.parse(raw) : {}
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Stored : {}
  } catch { return {} }
}
function writeStore(key: string, entry: { at: number; value: DexCandles }) {
  try {
    const all = readStore()
    all[key] = entry
    for (const k of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(STORE_MAX)) delete all[k]
    localStorage.setItem(STORE_KEY, JSON.stringify(all))
  } catch { /* Storage full / incognito: only loses instant-open, normal loading is unaffected */ }
}
const validStored = (e: unknown): e is { at: number; value: DexCandles } => {
  const x = e as { at?: unknown; value?: { candles?: unknown; supported?: unknown } } | null
  return !!x && typeof x.at === 'number' && !!x.value && Array.isArray(x.value.candles) && typeof x.value.supported === 'boolean'
}
type CandleInput = { chain: string; address: string; pairAddress: string; interval: DexInterval; bars?: number }
/** A chain counts as supported if any route recognizes it (full history doesn't necessarily go through GeckoTerminal anymore); inherited prototype keys don't count */
const knownChain = (chain: string) => Object.hasOwn(GECKO_NETWORK, chain) || Object.hasOwn(PAPRIKA_NETWORK, chain)
function keyOf(input: CandleInput): string | null {
  if (!knownChain(input.chain) || !input.pairAddress) return null
  return `${input.chain}:${input.pairAddress}:${input.interval}:${input.bars ?? 300}:${input.address}`
}

/** Candles already on hand (in memory or on device, however stale), used to draw the chart first; null when there's none */
export function peekDexCandles(input: CandleInput): DexCandles | null {
  const key = keyOf(input)
  if (!key) return null
  const hit = cache.get(key)
  if (hit) return hit.value
  const stored = readStore()[key]
  if (!validStored(stored)) return null
  cache.set(key, stored)   // Stored in memory with its original timestamp: freshness is judged by the original time, and the next load still fetches the latest
  return stored.value
}

/**
 * Prefetch: called on list press-down / Discover dwell. Skips silently when fresh data exists, a fetch is in flight, or the prefetch quota is exceeded; failures stay silent.
 * Only prefetches when the first full-history route is a direct connection (direct free quotas are per-IP); when the first route is the server channel, prefetchServerCandles reads the server cache only.
 */
export function prefetchDexCandles(input: CandleInput): void {
  if (candleConfig().full[0] !== 'geckoterminal') return
  const key = keyOf(input)
  if (!key || inflight.has(key)) return
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return
  const now = Date.now()
  if (now < limitedUntil) return
  while (prefetchTimes.length && now - prefetchTimes[0] > 60_000) prefetchTimes.shift()
  if (prefetchTimes.length >= PREFETCH_PER_MIN) return
  prefetchTimes.push(now)
  loadDexCandles(input).catch(() => {})
}

/** For tests: clear the memory cache, in-flight requests, and prefetch quota */
export function resetCandleCache() {
  cache.clear(); inflight.clear(); prefetchTimes.length = 0; limitedUntil = 0
}

const sameAddress = (a: string, b: string) => (a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b)

interface GtResponse {
  data?: { attributes?: { ohlcv_list?: unknown[][] } }
  meta?: { base?: { address?: string }; quote?: { address?: string } }
  errors?: { title?: string }[]
}

/** GeckoTerminal was rate-limited recently (no direct calls for one minute; full history falls back to our server) */
const geckoLimited = () => Date.now() < limitedUntil

async function fetchSide(network: string, pool: string, interval: DexInterval, bars: number, side: 'base' | 'quote'): Promise<GtResponse> {
  const [timeframe, aggregate] = TIMEFRAME[interval]
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${Math.min(1000, bars)}&currency=usd&token=${side}`
  let r: Response
  try { r = await fetch(url, { headers: { accept: 'application/json;version=20230302' } }) }
  catch {
    // ★ GeckoTerminal's free API is rate-limited per IP, and its 429s carry no CORS headers: the browser never sees a 429, only "Failed to fetch".
    // It used to rethrow as-is; with no rate-limit signal, prefetch and carousels kept hammering it and token pages were stuck on "candles failed to load" (2026-09-29 goat, spot page BTCB).
    // Treat connection failures as rate-limiting: no direct calls for one minute; full history goes to our server instead (fetchFull)
    limitedUntil = Date.now() + 60_000
    throw new Error(t('行情刷新太频繁，请稍后再试'))
  }
  if (r.status === 404) return { data: { attributes: { ohlcv_list: [] } }, errors: [{ title: 'not found' }] }
  if (r.status === 429) { limitedUntil = Date.now() + 60_000; throw new Error(t('行情刷新太频繁，请稍后再试')) }
  if (!r.ok) throw new Error(t('行情暂时无法加载（{status}）', { status: r.status }))
  return r.json() as Promise<GtResponse>
}

/**
 * Fetches candles. `signal` only lets the caller know it no longer wants the result (the page decides); the network request itself is never cancelled:
 * requests for the same pair are shared between the page and prefetch — one side leaving must not kill the other's result, and fetched results still enter the cache
 */
export async function loadDexCandles(input: CandleInput, signal?: AbortSignal): Promise<DexCandles> {
  void signal
  const { chain, address, pairAddress, interval } = input
  const base = { chain, address, pairAddress, interval, source: 'GeckoTerminal', quoteCurrency: 'USD' as const, volumeUnit: 'USD' as const }
  const key = keyOf(input)
  if (!key) return { ...base, candles: [], asOf: Date.now(), supported: false }
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const running = inflight.get(key)
  if (running) return running
  const job = fetchFull(input, key, base)
  inflight.set(key, job)
  job.catch(() => {}).finally(() => { if (inflight.get(key) === job) inflight.delete(key) })
  return job
}

/** Wait longer when the server channel serves full history: the server may be polling fallback vendors (slowest one waits up to 10 s) */
const FULL_SERVER_TIMEOUT_MS = 12_000

/**
 * Full history: follows the backend-configured order (default is direct GeckoTerminal only) — first to deliver wins.
 * When a route says "no such pair / pair mismatch", note it and try the next; if all fail: return supported:false when some route said so, otherwise throw the last error (page shows retry)
 */
async function fetchFull(input: CandleInput, key: string, base: Omit<DexCandles, 'candles' | 'asOf' | 'supported'>): Promise<DexCandles> {
  let lastErr: unknown = null
  let unsupported: DexCandles | null = null
  const routes = candleConfig().full
  for (const route of routes) {
    try {
      // During the one-minute rate-limit window, user-initiated opens still try direct once (only prefetch pauses); on failure it falls back to our server below
      const got = route === 'geckoterminal' ? await fetchGecko(input, base)
        : route === 'server' ? (serverUsable(input) ? await askServer(input, false, FULL_SERVER_TIMEOUT_MS, true) : null)
          : await loadQuickCandles(input)
      if (!got) continue
      if (!got.supported) { unsupported ??= got; continue }
      const entry = { at: Date.now(), value: got }
      cache.set(key, entry)
      if (got.candles.length) writeStore(key, entry)
      return got
    } catch (e) { lastErr = e }
  }
  if (unsupported) return unsupported
  // All configured routes failed (usually direct GeckoTerminal hit by per-IP rate limiting): ask our own server channel once more (skipped if it's already in the configured routes).
  // Only falls back to our own server — never direct to third parties not enabled in settings. When the server channel isn't provisioned / is throttled, it still fails and the page shows retry.
  if (lastErr && !routes.includes('server')) {
    const got = await loadServerCandles(input, FULL_SERVER_TIMEOUT_MS).catch(() => null)
    if (got?.supported && got.candles.length) {
      const entry = { at: Date.now(), value: got }
      cache.set(key, entry)
      writeStore(key, entry)
      return got
    }
  }
  if (lastErr) throw lastErr
  return { ...base, candles: [], asOf: Date.now(), supported: false }
}

/** Full history via direct GeckoTerminal; returns null for chains it doesn't recognize (move to the next route); network / rate-limit failures throw */
async function fetchGecko(input: CandleInput, base: Omit<DexCandles, 'candles' | 'asOf' | 'supported'>): Promise<DexCandles | null> {
  const { address, pairAddress, interval } = input
  const bars = input.bars ?? 300
  if (!Object.hasOwn(GECKO_NETWORK, input.chain)) return null
  const network = GECKO_NETWORK[input.chain]
  const src = { ...base, source: 'GeckoTerminal' }
  // Try the pool's base first; if this token is actually the pool's quote (e.g. USDC/XXX order flipped), retry with quote
  let res = await fetchSide(network, pairAddress, interval, bars, 'base')
  const meta = res.meta
  if (meta?.base?.address && !sameAddress(meta.base.address, address)) {
    if (meta.quote?.address && sameAddress(meta.quote.address, address)) res = await fetchSide(network, pairAddress, interval, bars, 'quote')
    else return { ...src, candles: [], asOf: Date.now(), supported: false } // If the pair and the token don't match, draw nothing rather than the wrong chart
  }
  if (res.errors?.length && !res.data?.attributes?.ohlcv_list?.length && res.errors[0]?.title === 'not found') return { ...src, candles: [], asOf: Date.now(), supported: false }

  const list = res.data?.attributes?.ohlcv_list ?? []
  const candles: Candle[] = []
  for (const row of list) {
    const [t, o, h, l, c, v] = row.map(Number)
    // GeckoTerminal returns Unix seconds, newest first; here we only validate and sort — never fill gaps
    if (![t, o, h, l, c, v].every(Number.isFinite) || t <= 0 || l <= 0 || h < Math.max(o, c) || l > Math.min(o, c)) continue
    candles.push({ time: Math.floor(t), open: o, high: h, low: l, close: c, volume: Math.max(0, v) })
  }
  const dedup = [...new Map(candles.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time)
  return { ...src, candles: dedup, asOf: Date.now(), supported: true }
}

// ---- First-screen fast candles: DexPaprika (2026-09-29) ----
// Measured on the same obscure BSC pair: GeckoTerminal 3.9 s vs DexPaprika 0.5 s; popular ones 0.27–0.65 s; same-hour closes differ ~0.1–0.2% between vendors (different sampling moments).
// DexPaprika's keyless tier only gives the last 24h at 1h+ intervals (15m needs a key, and keys can't ship in the app),
// so it only draws the latest 24 hourly candles, replaced wholesale once GeckoTerminal's full history arrives. Returns null on failure/timeout/bad format — never blocks normal loading.
// Chain keys are ours / DexScreener's → DexPaprika network ids (only chains present on both sides are listed)
const PAPRIKA_NETWORK: Record<string, string> = {
  solana: 'solana', ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum', bsc: 'bsc', polygon: 'polygon', optimism: 'optimism',
  avalanche: 'avalanche', linea: 'linea', zksync: 'zksync', scroll: 'scroll', blast: 'blast', mantle: 'mantle', sonic: 'sonic',
  berachain: 'berachain', unichain: 'unichain', celo: 'celo', fantom: 'fantom', cronos: 'cronos', robinhood: 'robinhood',
  hyperevm: 'hyperevm', arc: 'arc', monad: 'monad', megaeth: 'megaeth', plasma: 'plasma', katana: 'katana', flowevm: 'flow_evm',
}

export async function loadQuickCandles(input: CandleInput): Promise<DexCandles | null> {
  const network = PAPRIKA_NETWORK[input.chain]
  // Web never connects directly: this vendor sends no CORS headers for web origins, so browsers always block it (and log console errors); web only uses the server /api/candles (which doesn't allowlist it either)
  if (WEB_SURFACE || !network || !input.pairAddress || input.interval !== '1h') return null
  const start = Math.floor(Date.now() / 1000) - 23 * 3600
  try {
    // Lowercase 0x addresses: the vendor only accepts lowercase — checksummed addresses return empty arrays (measured 2026-09-29; the server channel does the same)
    const pair = /^0x[0-9a-fA-F]{40}$/.test(input.pairAddress) ? input.pairAddress.toLowerCase() : input.pairAddress
    const r = await fetch(`https://api.dexpaprika.com/networks/${network}/pools/${encodeURIComponent(pair)}/ohlcv?start=${start}&interval=1h&limit=24`, { signal: AbortSignal.timeout(2500) })
    if (!r.ok) return null
    const rows = await r.json() as { time_open?: string; open?: number; high?: number; low?: number; close?: number; volume?: number }[]
    if (!Array.isArray(rows)) return null
    const candles: Candle[] = []
    for (const x of rows) {
      const time = Math.floor(Date.parse(String(x.time_open)) / 1000)
      const [o, h, l, c, v] = [x.open, x.high, x.low, x.close, x.volume].map(Number)
      if (![time, o, h, l, c, v].every(Number.isFinite) || time <= 0 || l <= 0 || h < Math.max(o, c) || l > Math.min(o, c)) continue
      candles.push({ time, open: o, high: h, low: l, close: c, volume: Math.max(0, v) })
    }
    if (!candles.length) return null
    const sorted = [...new Map(candles.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time)
    return { chain: input.chain, address: input.address, pairAddress: input.pairAddress, interval: input.interval, candles: sorted, source: 'DexPaprika', asOf: Date.now(), quoteCurrency: 'USD', volumeUnit: 'USD', supported: true }
  } catch { return null }
}

// ---- Server candle channel: DexPaprika with API key (2026-09-29 goat approved DexPaprika first) ----
// When the server has DEXPAPRIKA_API_KEY, every interval (15m, 1h, 4h, 1d) first grabs an instant copy from the server, replaced wholesale once GeckoTerminal's full history arrives;
// if GeckoTerminal is slow or fails, this copy stays. A non-provisioned server replies enabled:false — remembered for 5 minutes, falling back to the keyless 1h direct route above.
// Include the token: the server judges direction by the pair's base / quote and withholds on mismatch — better to draw nothing.
const SERVER_OFF_MS = 5 * 60_000
let serverOffUntil = 0
// Prefetch (list press-down, Discover dwell) sends prefetch=1: the server only serves what's already cached (tokens others just viewed) — no DexPaprika requests, no quota spent;
// fetched data is cached on device for 60 s (same as the server cache) and used directly when the token page opens. Prefetch is capped at 20/min so it never eats the server's per-IP quota (60/min).
const SERVER_FAST_MS = 60_000
const SERVER_PREFETCH_PER_MIN = 20
const serverFast = new Map<string, { at: number; data: DexCandles }>()
const serverPending = new Map<string, Promise<DexCandles | null>>()
let serverPrefetchTimes: number[] = []
const serverKey = (x: CandleInput) => `${x.chain}:${x.pairAddress}:${x.interval}:${x.address}`.toLowerCase()

async function askServer(input: CandleInput, prefetch: boolean, timeoutMs = 3000, full = false): Promise<DexCandles | null> {
  try {
    const q = new URLSearchParams({ chain: input.chain, pair: input.pairAddress, interval: input.interval, token: input.address })
    if (prefetch) q.set('prefetch', '1')
    // Full history: the server asks the deeper-history vendor first and caches it for all users (2026-09-30: direct browser calls get per-IP rate-limited, leaving only 7 days of daily candles).
    if (full) q.set('full', '1')
    const r = await fetch(`${API_BASE}/api/candles?${q}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json() as { enabled?: boolean; source?: unknown; candles?: Candle[] }
    if (d.enabled === false) { serverOffUntil = Date.now() + SERVER_OFF_MS; return null }
    // When the server is throttled (limited:true) or upstream errors, candles comes back empty — return null here and let the caller fall back to direct.
    const candles = (Array.isArray(d.candles) ? d.candles : [])
      .filter((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.time > 0 && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))
      .sort((a, b) => a.time - b.time)
    if (!candles.length) return null
    // source is the vendor the server used (internal identifier, never shown in UI)
    const data: DexCandles = { chain: input.chain, address: input.address, pairAddress: input.pairAddress, interval: input.interval, candles, source: typeof d.source === 'string' ? d.source : 'server', asOf: Date.now(), quoteCurrency: 'USD', volumeUnit: 'USD', supported: true }
    if (!full) serverFast.set(serverKey(input), { at: Date.now(), data })
    return data
  } catch { return null }
}

/** Whether the settings use the server channel at all */
const usesServer = () => { const c = candleConfig(); return c.fast.includes('server') || c.full.includes('server') }
/** Whether the server channel can be asked this time: the server hasn't declared itself unavailable (serverReady=false in settings or a recent enabled:false), the chain is recognized, and there's a pair */
const serverUsable = (input: CandleInput) => Date.now() >= serverOffUntil && candleConfig().serverReady !== false && knownChain(input.chain) && !!input.pairAddress
const serverFresh = (input: CandleInput) => {
  const hit = serverFast.get(serverKey(input))
  return hit && Date.now() - hit.at < SERVER_FAST_MS ? hit.data : null
}

/** Prefetch candles already cached in the server channel (cache-read only, spends no DexPaprika quota) */
export function prefetchServerCandles(input: CandleInput) {
  if (!usesServer() || !serverUsable(input) || serverFresh(input)) return
  const key = serverKey(input)
  if (serverPending.has(key)) return
  const now = Date.now()
  serverPrefetchTimes = serverPrefetchTimes.filter((t) => now - t < 60_000)
  if (serverPrefetchTimes.length >= SERVER_PREFETCH_PER_MIN) return
  serverPrefetchTimes.push(now)
  const job = askServer(input, true).finally(() => serverPending.delete(key))
  serverPending.set(key, job)
}

/** Token page opens: use prefetched data first; wait for it if prefetch is in flight (server only checks cache, so it's fast); otherwise ask the server properly */
export async function loadServerCandles(input: CandleInput, timeoutMs?: number): Promise<DexCandles | null> {
  // Settings are being pulled from the server: wait for them (the on-device copy may predate the server channel's provisioning, see freshCandleConfig)
  await freshCandleConfig()
  if (!serverUsable(input)) return null
  const fresh = serverFresh(input)
  if (fresh) return fresh
  const key = serverKey(input)
  const pending = serverPending.get(key)
  if (pending && await pending) return serverFresh(input)
  if (Date.now() < serverOffUntil) return null
  // The first-screen fast chart and the full-history fallback may ask for the same pair simultaneously: share one request
  const job = askServer(input, false, timeoutMs).finally(() => { if (serverPending.get(key) === job) serverPending.delete(key) })
  serverPending.set(key, job)
  return job
}

/**
 * First-screen fast candles: follow the backend-configured order (default: server channel first — all intervals; keyless direct — 1h only — when unprovisioned or empty),
 * first to deliver wins; null when nothing arrives (wait for full history).
 */
export async function loadFastCandles(input: CandleInput): Promise<DexCandles | null> {
  for (const route of candleConfig().fast) {
    const got = route === 'server' ? await loadServerCandles(input)
      : route === 'dexpaprika' ? await loadQuickCandles(input)
        : geckoLimited() ? null
          : await fetchGecko(input, { chain: input.chain, address: input.address, pairAddress: input.pairAddress, interval: input.interval, source: 'GeckoTerminal', quoteCurrency: 'USD', volumeUnit: 'USD' }).catch(() => null)
    if (got && got.supported && got.candles.length) return got
  }
  return null
}

/** For tests: clear the "server not provisioned" memory, prefetch cache, and prefetch quota */
export function resetServerCandleChannel() { serverOffUntil = 0; serverFast.clear(); serverPending.clear(); serverPrefetchTimes = [] }
