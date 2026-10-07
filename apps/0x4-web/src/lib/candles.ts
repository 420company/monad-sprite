// DEX 现货历史 K 线。只按「链 + 交易对地址」取，不按 symbol 猜。
// 契约见 docs/CANDLE_DATA_INTERFACE.md：没成交的时段留缺口，不插值；不支持的链返回 supported:false；网络/限流失败抛错。
// ★走哪几条路、什么顺序由后台「数据源」页决定（src/lib/candleConfig.ts，2026-09-29 goat：换 K 线商家不用发 App）：
//   首屏快速图 loadFastCandles、完整历史 loadDexCandles 各按设置的顺序试，谁先拿到用谁；
//   路：server = 我们的服务器通道（数据商在服务器上换）；dexpaprika = 直连免密钥快线（只有 1 小时）；geckoterminal = 直连完整历史。
//   默认（后台没改）= 首屏先服务器再免密钥直连，完整历史直连 GeckoTerminal，和以前一样。
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

/** DexScreener 链标识 → GeckoTerminal 网络 id：统一用 chains.ts 的 GECKO_NETWORK（2026-09-25 起，发现页榜单也用它）；不在表里的链就是不支持 */
const TIMEFRAME: Record<DexInterval, [string, number]> = { '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] }
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: DexCandles }>()

// ---- 秒开（2026-09-29 goat：点开币种 K 线总是不能秒出）----
// 实测 GeckoTerminal 同一个交易对第一次请求约 2.5 秒（它那边现算），紧接着再请求 0.1~0.2 秒。三招：
// 1. 上次看过的 K 线存在本机（localStorage，最多 STORE_MAX 份），再打开同一个币先把旧图画出来，后台换成最新的
// 2. 同一个交易对同一个周期正在请求时不重复发，页面打开时直接接上手指按下时已经发出的那一次
// 3. 预取（列表上手指按下、发现页停留）有额度：GeckoTerminal 免费接口按 IP 每分钟 30 次，
//    预取每分钟最多 PREFETCH_PER_MIN 次，碰到过 429 的一分钟内不预取，把额度留给用户真正点开的请求
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
  } catch { /* 存不下 / 无痕模式：只是少了秒开，不影响正常加载 */ }
}
const validStored = (e: unknown): e is { at: number; value: DexCandles } => {
  const x = e as { at?: unknown; value?: { candles?: unknown; supported?: unknown } } | null
  return !!x && typeof x.at === 'number' && !!x.value && Array.isArray(x.value.candles) && typeof x.value.supported === 'boolean'
}
type CandleInput = { chain: string; address: string; pairAddress: string; interval: DexInterval; bars?: number }
/** 任何一条路认得的链都算支持（完整历史不一定走 GeckoTerminal 了）；原型上的键不算 */
const knownChain = (chain: string) => Object.hasOwn(GECKO_NETWORK, chain) || Object.hasOwn(PAPRIKA_NETWORK, chain)
function keyOf(input: CandleInput): string | null {
  if (!knownChain(input.chain) || !input.pairAddress) return null
  return `${input.chain}:${input.pairAddress}:${input.interval}:${input.bars ?? 300}:${input.address}`
}

/** 手上已有的 K 线（内存或本机存的，不管多旧），用来先把图画出来；没有返回 null */
export function peekDexCandles(input: CandleInput): DexCandles | null {
  const key = keyOf(input)
  if (!key) return null
  const hit = cache.get(key)
  if (hit) return hit.value
  const stored = readStore()[key]
  if (!validStored(stored)) return null
  cache.set(key, stored)   // 带着原来的时间放进内存：是不是新鲜照原来的时间算，下一次加载照样去拿最新的
  return stored.value
}

/**
 * 预取：列表上手指按下、发现页停留时调用。已有新鲜的、正在拉、超出预取额度都直接跳过，失败不提示。
 * 只在完整历史的第一条路是直连时预取（直连的免费额度按 IP 算）；第一条是服务器通道时由 prefetchServerCandles 只读服务器缓存
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

/** 测试用：清空内存缓存、在途请求和预取额度 */
export function resetCandleCache() {
  cache.clear(); inflight.clear(); prefetchTimes.length = 0; limitedUntil = 0
}

const sameAddress = (a: string, b: string) => (a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b)

interface GtResponse {
  data?: { attributes?: { ohlcv_list?: unknown[][] } }
  meta?: { base?: { address?: string }; quote?: { address?: string } }
  errors?: { title?: string }[]
}

/** GeckoTerminal 最近被限流过（一分钟内不再直连它，完整历史改问我们的服务器） */
const geckoLimited = () => Date.now() < limitedUntil

async function fetchSide(network: string, pool: string, interval: DexInterval, bars: number, side: 'base' | 'quote'): Promise<GtResponse> {
  const [timeframe, aggregate] = TIMEFRAME[interval]
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${Math.min(1000, bars)}&currency=usd&token=${side}`
  let r: Response
  try { r = await fetch(url, { headers: { accept: 'application/json;version=20230302' } }) }
  catch {
    // ★GeckoTerminal 免费接口按 IP 限流，回的 429 不带跨域头：浏览器里看不到 429，只有「Failed to fetch」。
    // 以前这里原样抛出，不知道是限流，预取和轮播接着打它，币种页一直「K 线加载失败」（2026-09-29 goat 现货页 BTCB）。
    // 连不上当限流处理：一分钟内不再直连，完整历史改问我们的服务器（fetchFull）
    limitedUntil = Date.now() + 60_000
    throw new Error(t('行情刷新太频繁，请稍后再试'))
  }
  if (r.status === 404) return { data: { attributes: { ohlcv_list: [] } }, errors: [{ title: 'not found' }] }
  if (r.status === 429) { limitedUntil = Date.now() + 60_000; throw new Error(t('行情刷新太频繁，请稍后再试')) }
  if (!r.ok) throw new Error(t('行情暂时无法加载（{status}）', { status: r.status }))
  return r.json() as Promise<GtResponse>
}

/**
 * 拉 K 线。signal 只用来让调用方知道自己已经不要结果了（页面自己判断），网络请求本身不跟着取消：
 * 同一个交易对的请求会被页面、预取共用，一方离开不能把另一方要的结果掐掉，拉到的结果照样进缓存
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

/** 服务器通道当完整历史用时等久一点：服务器那边可能在轮备用数据商（最慢的一家最多等 10 秒） */
const FULL_SERVER_TIMEOUT_MS = 12_000

/**
 * 完整历史：按后台设置的顺序走（默认只有直连 GeckoTerminal），谁先拿到用谁。
 * 某条路说「这个交易对没有 / 对不上」先记着再试下一条；都没拿到时：有路说没有就回 supported:false，否则把最后一个错误抛出去（页面显示重试）
 */
async function fetchFull(input: CandleInput, key: string, base: Omit<DexCandles, 'candles' | 'asOf' | 'supported'>): Promise<DexCandles> {
  let lastErr: unknown = null
  let unsupported: DexCandles | null = null
  const routes = candleConfig().full
  for (const route of routes) {
    try {
      // 限流过的一分钟里用户点开的照常直连试一次（预取才停），失败了由下面退到我们的服务器
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
  // 设置里的路都失败了（多半是直连 GeckoTerminal 被按 IP 限流）：再问一次我们自己的服务器通道（设置里已经有它的不重复问）。
  // 只退到我们自己的服务器，不去直连设置里没勾的第三方。服务器没开通 / 被限速时拿不到，照旧报错让页面显示重试
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

/** 直连 GeckoTerminal 取完整历史；这条链它不认返回 null（换下一条路）；网络 / 限流失败抛错 */
async function fetchGecko(input: CandleInput, base: Omit<DexCandles, 'candles' | 'asOf' | 'supported'>): Promise<DexCandles | null> {
  const { address, pairAddress, interval } = input
  const bars = input.bars ?? 300
  if (!Object.hasOwn(GECKO_NETWORK, input.chain)) return null
  const network = GECKO_NETWORK[input.chain]
  const src = { ...base, source: 'GeckoTerminal' }
  // 先按池子的 base 取；如果这个币其实是池子的 quote（比如 USDC/XXX 的顺序反了），换 quote 再取一次
  let res = await fetchSide(network, pairAddress, interval, bars, 'base')
  const meta = res.meta
  if (meta?.base?.address && !sameAddress(meta.base.address, address)) {
    if (meta.quote?.address && sameAddress(meta.quote.address, address)) res = await fetchSide(network, pairAddress, interval, bars, 'quote')
    else return { ...src, candles: [], asOf: Date.now(), supported: false } // 交易对和代币对不上，宁可不画
  }
  if (res.errors?.length && !res.data?.attributes?.ohlcv_list?.length && res.errors[0]?.title === 'not found') return { ...src, candles: [], asOf: Date.now(), supported: false }

  const list = res.data?.attributes?.ohlcv_list ?? []
  const candles: Candle[] = []
  for (const row of list) {
    const [t, o, h, l, c, v] = row.map(Number)
    // GeckoTerminal 给的是 Unix 秒、最新在前；这里只做校验和排序，不补缺口
    if (![t, o, h, l, c, v].every(Number.isFinite) || t <= 0 || l <= 0 || h < Math.max(o, c) || l > Math.min(o, c)) continue
    candles.push({ time: Math.floor(t), open: o, high: h, low: l, close: c, volume: Math.max(0, v) })
  }
  const dedup = [...new Map(candles.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time)
  return { ...src, candles: dedup, asOf: Date.now(), supported: true }
}

// ---- 首屏快速 K 线：DexPaprika（2026-09-29）----
// 实测同一个冷门 BSC 交易对：GeckoTerminal 3.9 秒，DexPaprika 0.5 秒；热门的 0.27~0.65 秒；同一小时收盘价两家相差约 0.1~0.2%（取样时刻不同）。
// DexPaprika 不要密钥只给最近 24 小时、1 小时及以上周期（15 分钟要密钥，密钥不能放进 App），
// 所以只在 1 小时周期上先把最近 24 根画出来，GeckoTerminal 的完整历史到了再整张换掉。拿不到、超时、格式不对都返回 null，不影响正常加载。
// 链标识是我们 / DexScreener 的 key → DexPaprika 的网络 id（只列两边都有的）
const PAPRIKA_NETWORK: Record<string, string> = {
  solana: 'solana', ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum', bsc: 'bsc', polygon: 'polygon', optimism: 'optimism',
  avalanche: 'avalanche', linea: 'linea', zksync: 'zksync', scroll: 'scroll', blast: 'blast', mantle: 'mantle', sonic: 'sonic',
  berachain: 'berachain', unichain: 'unichain', celo: 'celo', fantom: 'fantom', cronos: 'cronos', robinhood: 'robinhood',
  hyperevm: 'hyperevm', arc: 'arc', monad: 'monad', megaeth: 'megaeth', plasma: 'plasma', katana: 'katana', flowevm: 'flow_evm',
}

export async function loadQuickCandles(input: CandleInput): Promise<DexCandles | null> {
  const network = PAPRIKA_NETWORK[input.chain]
  // 网页版不直连：这家数据商不给网页来源回跨域头，浏览器必拦，还会在控制台报错；网页版只走服务器 /api/candles（安全头也没放行它）
  if (WEB_SURFACE || !network || !input.pairAddress || input.interval !== '1h') return null
  const start = Math.floor(Date.now() / 1000) - 23 * 3600
  try {
    // 0x 地址转小写：数据商只认小写，带校验大小写的地址会回空数组（2026-09-29 实测，服务器通道也同样处理）
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

// ---- 服务器 K 线通道：DexPaprika 带密钥（2026-09-29 goat 同意先用 DexPaprika）----
// 服务器配了 DEXPAPRIKA_API_KEY 时，所有周期（15 分钟、1 小时、4 小时、日线）都先从服务器拿一份秒出，GeckoTerminal 的完整历史到了再整张换掉；
// GeckoTerminal 慢或失败时就留着这一份。服务器没开通会回 enabled:false，记 5 分钟不再问，退回上面的免密钥 1 小时直连。
// 带上 token：服务器按交易对的 base / quote 判断方向，对不上就不给，宁可不画。
const SERVER_OFF_MS = 5 * 60_000
let serverOffUntil = 0
// 预取（列表按下、发现页停留）带 prefetch=1：服务器只给已经缓存的（别人刚看过的币），不向 DexPaprika 发请求、不花额度；
// 拿到的在本机记 60 秒（和服务器缓存一样长），点开币种页直接用。预取每分钟最多 20 次，不挤占服务器按 IP 的额度（每分钟 60 次）
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
    // 完整历史：服务器先问历史深的那家并缓存，所有用户共用（2026-09-30：浏览器直连会被按 IP 限流，日线只剩 7 天）
    if (full) q.set('full', '1')
    const r = await fetch(`${API_BASE}/api/candles?${q}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json() as { enabled?: boolean; source?: unknown; candles?: Candle[] }
    if (d.enabled === false) { serverOffUntil = Date.now() + SERVER_OFF_MS; return null }
    // 服务器被限速（limited:true）或上游出错时 candles 是空的，这里返回 null，由调用方退回直连
    const candles = (Array.isArray(d.candles) ? d.candles : [])
      .filter((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.time > 0 && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))
      .sort((a, b) => a.time - b.time)
    if (!candles.length) return null
    // source 是服务器用的数据商（内部标识，界面不显示）
    const data: DexCandles = { chain: input.chain, address: input.address, pairAddress: input.pairAddress, interval: input.interval, candles, source: typeof d.source === 'string' ? d.source : 'server', asOf: Date.now(), quoteCurrency: 'USD', volumeUnit: 'USD', supported: true }
    if (!full) serverFast.set(serverKey(input), { at: Date.now(), data })
    return data
  } catch { return null }
}

/** 设置里有没有用到服务器通道 */
const usesServer = () => { const c = candleConfig(); return c.fast.includes('server') || c.full.includes('server') }
/** 服务器通道这次能不能问：服务器没说自己用不了（设置里 serverReady=false 或刚回过 enabled:false）、链认得、有交易对 */
const serverUsable = (input: CandleInput) => Date.now() >= serverOffUntil && candleConfig().serverReady !== false && knownChain(input.chain) && !!input.pairAddress
const serverFresh = (input: CandleInput) => {
  const hit = serverFast.get(serverKey(input))
  return hit && Date.now() - hit.at < SERVER_FAST_MS ? hit.data : null
}

/** 预取服务器通道里已经缓存的 K 线（只读缓存，不花 DexPaprika 额度） */
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

/** 币种页打开：先用预取到的，预取正在路上就等它（服务器只查缓存，很快），都没有再正式问服务器 */
export async function loadServerCandles(input: CandleInput, timeoutMs?: number): Promise<DexCandles | null> {
  // 设置正在从服务器拉：等它（本机存的可能是服务器开通前的旧设置，见 freshCandleConfig）
  await freshCandleConfig()
  if (!serverUsable(input)) return null
  const fresh = serverFresh(input)
  if (fresh) return fresh
  const key = serverKey(input)
  const pending = serverPending.get(key)
  if (pending && await pending) return serverFresh(input)
  if (Date.now() < serverOffUntil) return null
  // 首屏快速图和完整历史的兜底可能同时来问同一个交易对：共用一次请求
  const job = askServer(input, false, timeoutMs).finally(() => { if (serverPending.get(key) === job) serverPending.delete(key) })
  serverPending.set(key, job)
  return job
}

/**
 * 首屏快速 K 线：按后台设置的顺序走（默认先问服务器通道——全部周期，没开通或没拿到再用免密钥直连——只有 1 小时周期），
 * 谁先拿到用谁；都没拿到返回 null（等完整历史）
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

/** 测试用：清掉「服务器没开通」的记忆、预取缓存和预取额度 */
export function resetServerCandleChannel() { serverOffUntil = 0; serverFast.clear(); serverPending.clear(); serverPrefetchTimes = [] }
