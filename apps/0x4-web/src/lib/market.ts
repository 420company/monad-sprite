// Market data source: DexScreener public API (no API key needed), all chains supported
// Throws on API failure; callers only mark offline — never paper over with fake data
import { API_BASE, ENV } from './env'
import { fetchJson } from './http'
import { MOCK_TOKENS, SOL_MINT, USDC_MINT } from './mock'
import { chainByDexKey, chainByGecko, tokenLogo, SOLANA_CHAIN_ID } from './chains'
import type { MarketToken } from './types'
import type { FeedKind, FeedPart } from './marketFeed'
import { t } from '@/lib/i18n'
import { assetForSymbol, mainstreamLookalike, normSymbol, officialAssetOf } from './officialTokens'

/** DexScreener pair shape (only the fields we use are declared) */
interface DsPair {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; name: string; symbol: string }
  priceNative?: string
  priceUsd?: string
  txns?: { h24?: { buys: number; sells: number } }
  volume?: { h24?: number }
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number }
  liquidity?: { usd?: number }
  fdv?: number
  marketCap?: number
  pairCreatedAt?: number
  info?: { imageUrl?: string }
}

interface DsBoost {
  chainId: string
  tokenAddress: string
  icon?: string
  description?: string
  url?: string
}

const API = ENV.dexscreenerApi

export const marketKey = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`

/** One pair → token quote */
function pairToToken(p: DsPair): MarketToken {
  return {
    chain: p.chainId,
    chainId: chainByDexKey(p.chainId)?.id ?? 0,
    address: p.baseToken.address,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    logo: tokenLogo(p.chainId, p.baseToken.address, p.info?.imageUrl),
    priceUsd: Number(p.priceUsd || 0),
    priceNative: Number(p.priceNative || 0),
    change5m: p.priceChange?.m5,
    change1h: p.priceChange?.h1,
    change6h: p.priceChange?.h6,
    change24h: p.priceChange?.h24,
    volume24h: p.volume?.h24,
    liquidityUsd: p.liquidity?.usd,
    marketCap: p.marketCap,
    fdv: p.fdv,
    buys24h: p.txns?.h24?.buys,
    sells24h: p.txns?.h24?.sells,
    pairAddress: p.pairAddress,
    dexId: p.dexId,
    createdAt: p.pairCreatedAt,
    url: p.url,
  }
}

/** A token may have multiple pairs: pick the most liquid by "chain + address"; keep only chains we support trading on */
function bestPairs(pairs: DsPair[], onlyChain?: string): MarketToken[] {
  const byToken = new Map<string, DsPair>()
  for (const p of pairs) {
    if (onlyChain && p.chainId !== onlyChain) continue
    if (!chainByDexKey(p.chainId)) continue
    const k = marketKey(p.chainId, p.baseToken.address)
    const prev = byToken.get(k)
    if (!prev || (p.liquidity?.usd || 0) > (prev.liquidity?.usd || 0)) byToken.set(k, p)
  }
  return [...byToken.values()].map(pairToToken)
}

/** Batch-fetch token quotes on one chain (max 30 addresses per batch) */
export async function getTokens(addresses: string[], chain = 'solana'): Promise<MarketToken[]> {
  const uniq = [...new Set(addresses.filter(Boolean))]
  const chunks: string[][] = []
  for (let i = 0; i < uniq.length; i += 30) chunks.push(uniq.slice(i, i + 30))
  // Fire batches in parallel (used to be sequential — 60 addresses took two round trips)
  const results = await Promise.all(chunks.map((chunk) => fetchJson<DsPair[]>(`${API}/tokens/v1/${chain}/${chunk.join(',')}`)))
  return results.flatMap((pairs) => bestPairs(pairs, chain))
}

export async function getToken(address: string, chain = 'solana'): Promise<MarketToken | undefined> {
  const list = await getTokens([address], chain)
  return list[0]
}

/** Look up by contract address across all chains (for "add token") */
export async function lookupAnyChain(address: string): Promise<MarketToken[]> {
  const res = await fetchJson<{ pairs: DsPair[] | null }>(`${API}/latest/dex/tokens/${encodeURIComponent(address.trim())}`)
  return bestPairs(res.pairs || []).sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0))
}

/** Hot tokens: DexScreener boosted list + majors, sorted by 24h volume (Solana) */
export async function getTrending(): Promise<MarketToken[]> {
  const boosts = await fetchJson<DsBoost[]>(`${API}/token-boosts/top/v1`).catch(() => [] as DsBoost[])
  const boosted = boosts.filter((b) => b.chainId === 'solana').map((b) => b.tokenAddress)
  const curated = MOCK_TOKENS.map((t) => t.address)
  const tokens = await getTokens([...curated, ...boosted].slice(0, 60), 'solana')
  const desc = new Map(boosts.map((b) => [b.tokenAddress, b.description]))
  return tokens
    .map((t) => ({ ...t, description: desc.get(t.address) }))
    .filter((t) => (t.liquidityUsd || 0) > 5_000)
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
}

/**
 * Search results (2026-09-30 goat: "searching btc returns this many", "BTC/PEPE impersonators need handling too"):
 *   tokens  to display: official contracts first (BNB Chain's first), tagged "official"; the rest by liquidity + volume.
 *   There used to be a hidden field (collapsed same-name tokens); 2026-09-30 goat decided impersonators are never shown, no more collapsing — the field is gone.
 */
export interface SearchResult { tokens: MarketToken[] }

/** Dead pool: liquidity under $5,000 AND 24h volume under $1,000 (same bar as the market page's "liquidity ≥ $5,000") */
export const SEARCH_MIN_LIQUIDITY = 5_000
export const SEARCH_MIN_VOLUME = 1_000
/** "Newly created": pool created within the last 3 days (flagged in search results — higher risk) */
export const NEW_POOL_MS = 3 * 86_400_000
/** Same-name tokens beyond the first are shown when either holds: established (liquidity ≥ $50k, pool older than 3 days, 24h volume ≥ $10k) or new (pool ≤ 3 days old, 24h volume ≥ $10k with ≥ 100 trades) */
export const SAME_NAME_MIN_LIQUIDITY = 50_000
export const SAME_NAME_MIN_VOLUME = 10_000
export const SAME_NAME_MIN_TXNS = 100
const SEARCH_LIMIT = 30

/** Whether the query is a contract address (EVM 0x + 40 hex chars, or Solana base58 32–44 chars) */
export const isAddressQuery = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q.trim()) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim())

/** Composite score: liquidity + half of 24h volume (high volume means real trading, but volume is easier to wash than liquidity) */
const searchScore = (x: MarketToken) => (x.liquidityUsd || 0) + (x.volume24h || 0) / 2

/** Whether the pool was created within the last 3 days (pools with unknown creation time don't count) */
export const isNewPool = (x: Pick<MarketToken, 'createdAt'>, now = Date.now()) => !!x.createdAt && now - x.createdAt <= NEW_POOL_MS

/** Whether same-name tokens beyond the first may show: established ones judged by liquidity + volume, new ones by volume + trade count (new tokens with real trading aren't blocked) */
export function sameNameVisible(x: MarketToken, now = Date.now()): boolean {
  const vol = x.volume24h || 0
  if (vol < SAME_NAME_MIN_VOLUME) return false
  if (isNewPool(x, now)) return (x.buys24h || 0) + (x.sells24h || 0) >= SAME_NAME_MIN_TXNS
  return !!x.createdAt && (x.liquidityUsd || 0) >= SAME_NAME_MIN_LIQUIDITY
}

/**
 * Sort and filter search results (pure function, easy to unit-test):
 *   · Tokens in the official list (hand-curated majors / stablecoins + top 200): only the official contract shows; non-official contracts with the same symbol (or ERC20-USDT-style impersonations) never show.
 *   · Ordinary tokens not in the official list: the highest-scoring of each symbol shows as usual (only dead pools filtered); beyond the first, sameNameVisible's bar applies — below it, hidden.
 *   · Non-official tokens whose pool is ≤ 3 days old are tagged fresh (UI shows "newly created").
 *   · Pasted contract address: the user explicitly wants that token, so no filtering; impersonators of majors are tagged impostor (UI shows "unofficial").
 */
export function rankSearch(list: MarketToken[], q: string, now = Date.now()): SearchResult {
  // The same token may arrive via two paths (search API + official-list direct lookup): dedupe by "chain + address", keep the more liquid copy
  const byKey = new Map<string, MarketToken>()
  for (const x of list) {
    const k = marketKey(x.chain, x.address)
    const prev = byKey.get(k)
    if (!prev || (x.liquidityUsd || 0) > (prev.liquidityUsd || 0)) byKey.set(k, x)
  }
  const all = [...byKey.values()].map((x) => {
    const official = !!officialAssetOf(x.chain, x.address)
    const like = official ? undefined : mainstreamLookalike(x.symbol)
    // Name clashes with lenient assets (auto-listed short symbols) don't count as impersonation
    return { ...x, official, impostor: !!like && !like.loose, fresh: !official && isNewPool(x, now) }
  })
  // Query matches a token in the official list (usdt / btc / pepe…): show only that token (searching usdt hides USDC, AIPF, etc. that merely pair with USDT)
  const asset = isAddressQuery(q) ? undefined : assetForSymbol(q.trim())
  const officials = all.filter((x) => x.official && (!asset || officialAssetOf(x.chain, x.address) === asset))
    .sort((a, b) => Number(b.chain === 'bsc') - Number(a.chain === 'bsc') || searchScore(b) - searchScore(a))
  const rest = all.filter((x) => !x.official).sort((a, b) => searchScore(b) - searchScore(a))
  if (isAddressQuery(q)) return { tokens: [...officials, ...rest].slice(0, SEARCH_LIMIT) }

  const shown: MarketToken[] = []
  const seen = new Set<string>()
  // Query matches a lenient asset (short symbols like AI, LIT): the official one already ranks first; other same-name tokens count as "beyond the first" and must clear the same-name bar
  if (asset?.loose) seen.add(normSymbol(asset.symbol))
  for (const x of rest) {
    // Non-official contracts of tokens in the official list (impersonators): never shown (2026-09-30 goat)
    if (x.impostor) continue
    // Query matches an official-list token: unrelated results are hidden too (lenient assets keep same-name only)
    if (asset && (!asset.loose || normSymbol(x.symbol) !== normSymbol(asset.symbol))) continue
    if ((x.liquidityUsd || 0) < SEARCH_MIN_LIQUIDITY && (x.volume24h || 0) < SEARCH_MIN_VOLUME) continue
    const k = normSymbol(x.symbol)
    if (seen.has(k) && !sameNameVisible(x, now)) continue
    seen.add(k)
    shown.push({ ...x, impostor: false })
  }
  return { tokens: [...officials, ...shown].slice(0, SEARCH_LIMIT) }
}

/** Search: name, symbol, or contract address across all supported chains. When the query is a major (btc / eth / usdt…), the official contract is also looked up directly by address to guarantee it's in the results */
export async function searchTokensGrouped(q: string): Promise<SearchResult> {
  const query = q.trim()
  if (!query) return { tokens: [] }
  const asset = assetForSymbol(query)
  const byChain = new Map<string, string[]>()
  for (const [c, a] of asset?.tokens ?? []) byChain.set(c, [...(byChain.get(c) || []), a])
  const [res, ...officials] = await Promise.all([
    fetchJson<{ pairs: DsPair[] | null }>(`${API}/latest/dex/search?q=${encodeURIComponent(query)}`),
    // Official-list direct lookup failing doesn't affect the search itself
    ...[...byChain].map(([c, addrs]) => getTokens(addrs, c).catch(() => [] as MarketToken[])),
  ])
  return rankSearch([...officials.flat(), ...bestPairs(res.pairs || [])], query)
}

/** Only the normally-displayed subset (used by legacy call sites) */
export async function searchTokens(q: string): Promise<MarketToken[]> {
  return (await searchTokensGrouped(q)).tokens
}

/** SOL price (USD) */
export async function getSolPrice(): Promise<number> {
  const t = await getToken(SOL_MINT)
  return t?.priceUsd || 0
}

export { SOL_MINT, USDC_MINT }


/** Batch-fetch quotes for a DexScreener "chain + address" list per chain; preserves order, dedupes, keeps only chains we support */
async function resolveList(items: { chainId: string; tokenAddress: string }[], limit = 40): Promise<MarketToken[]> {
  const byChain = new Map<string, string[]>()
  for (const it of items) {
    if (!it?.chainId || !it?.tokenAddress || !chainByDexKey(it.chainId)) continue
    const arr = byChain.get(it.chainId) || []
    if (!arr.some((a) => a.toLowerCase() === it.tokenAddress.toLowerCase())) arr.push(it.tokenAddress)
    byChain.set(it.chainId, arr)
  }
  const settled = await Promise.allSettled([...byChain].map(([chain, addrs]) => getTokens(addrs.slice(0, limit), chain)))
  const found = new Map<string, MarketToken>()
  settled.forEach((r) => { if (r.status === 'fulfilled') r.value.forEach((t) => found.set(marketKey(t.chain, t.address), t)) })
  const out: MarketToken[] = []
  for (const it of items) { const t = found.get(marketKey(it.chainId, it.tokenAddress)); if (t && !out.includes(t)) out.push(t) }
  return out
}

/** Hot: DexScreener boosted list (paid promotion by projects — the hype is real but says nothing about quality), quotes fetched per chain */
export async function getBoosted(): Promise<MarketToken[]> {
  const items = await fetchJson<{ chainId: string; tokenAddress: string; totalAmount?: number }[]>(`${API}/token-boosts/top/v1`)
  return resolveList(items)
}

/** New: most recently profiled tokens on DexScreener, filtering out low-liquidity vaporware */
export async function getLatest(): Promise<MarketToken[]> {
  const items = await fetchJson<{ chainId: string; tokenAddress: string }[]>(`${API}/token-profiles/latest/v1`)
  return (await resolveList(items)).filter((t) => (t.liquidityUsd || 0) >= 5000)
}

/** Stock tokens: xStocks (tokenized US stocks / ETFs issued by Backed). The list comes from xstocks.com (scripts/fetch-xstocks.mjs → public/xstocks.json),
 *  quotes are batch-fetched via Jupiter by mint (100 at a time), keeping only liquid ones, sorted by 24h volume */
export async function getStocks(): Promise<MarketToken[]> {
  const { list } = await fetchJson<{ list: { symbol: string; name: string; icon: string | null; solana: string }[] }>(`${import.meta.env.BASE_URL}xstocks.json`)
  const meta = new Map(list.map((x) => [x.solana, x]))
  const mints = list.map((x) => x.solana)
  const batches: string[][] = []
  for (let i = 0; i < mints.length; i += 100) batches.push(mints.slice(i, i + 100))
  interface Jup { id: string; symbol: string; name: string; icon?: string; usdPrice?: number; liquidity?: number; mcap?: number; fdv?: number; stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number }; stats1h?: { priceChange?: number }; stats6h?: { priceChange?: number }; stats5m?: { priceChange?: number }; firstPool?: { createdAt?: string } }
  const settled = await Promise.allSettled(batches.map((b) => fetchJson<Jup[]>(`https://lite-api.jup.ag/tokens/v2/search?query=${b.join(',')}`)))
  const out: MarketToken[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const t of r.value) {
      if (!(t.liquidity && t.liquidity >= 1000) || !t.usdPrice) continue
      const m = meta.get(t.id)
      out.push({ chain: 'solana', chainId: SOLANA_CHAIN_ID, address: t.id, symbol: t.symbol, name: m?.name || t.name, logo: [m?.icon, t.icon].filter(Boolean).join('|'),
        priceUsd: t.usdPrice, change5m: t.stats5m?.priceChange, change1h: t.stats1h?.priceChange, change6h: t.stats6h?.priceChange, change24h: t.stats24h?.priceChange,
        volume24h: (t.stats24h?.buyVolume || 0) + (t.stats24h?.sellVolume || 0), liquidityUsd: t.liquidity, marketCap: t.mcap, fdv: t.fdv, buys24h: t.stats24h?.numBuys, sells24h: t.stats24h?.numSells,
        createdAt: t.firstPool?.createdAt ? Date.parse(t.firstPool.createdAt) : undefined, url: `https://dexscreener.com/solana/${t.id}` })
    }
  }
  if (!out.length && settled.every((r) => r.status === 'rejected')) throw new Error(t('股票行情暂时无法加载'))
  return out.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
}

// ---------------------------------------------------------------------------
// More data sources (2026-09-25 goat: the Discover page showed only a dozen tokens).
// ⚠️ Same day, real-device testing showed only Solana left: GeckoTerminal's free tier is 30 req/min per IP — a few tab switches on one phone and it's 429.
//    Switched to prefer our server's aggregated /api/market/pools (server/src/marketLists.ts — the server pulls slowly and caches),
//    falling back to direct only when the server lacks the endpoint, and then only a few pages.
// DexScreener's boosted / latest lists give 30 at a time, and liquidity filtering leaves a dozen. Adding two free sources:
//   · Jupiter 24h hot list: Solana, 100 at a time, with price / liquidity / volume
//   · GeckoTerminal: hot / new pools per chain, 20 per page, pageable (free tier 30/min; 60 s cache here)
// ---------------------------------------------------------------------------

interface JupToken { id: string; symbol: string; name: string; icon?: string; usdPrice?: number; liquidity?: number; mcap?: number; fdv?: number; stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number }; stats1h?: { priceChange?: number }; stats6h?: { priceChange?: number }; stats5m?: { priceChange?: number }; firstPool?: { createdAt?: string } }

function fromJup(x: JupToken, logo?: string): MarketToken {
  return { chain: 'solana', chainId: SOLANA_CHAIN_ID, address: x.id, symbol: x.symbol, name: x.name, logo: [logo, x.icon].filter(Boolean).join('|'),
    priceUsd: x.usdPrice || 0, change5m: x.stats5m?.priceChange, change1h: x.stats1h?.priceChange, change6h: x.stats6h?.priceChange, change24h: x.stats24h?.priceChange,
    volume24h: (x.stats24h?.buyVolume || 0) + (x.stats24h?.sellVolume || 0), liquidityUsd: x.liquidity, marketCap: x.mcap, fdv: x.fdv, buys24h: x.stats24h?.numBuys, sells24h: x.stats24h?.numSells,
    createdAt: x.firstPool?.createdAt ? Date.parse(x.firstPool.createdAt) : undefined, url: `https://dexscreener.com/solana/${x.id}` }
}

/** Jupiter 24h hot list (Solana, up to 100) */
async function jupTrending(): Promise<MarketToken[]> {
  const list = await fetchJson<JupToken[]>('https://lite-api.jup.ag/tokens/v2/toptrending/24h?limit=100')
  return list.filter((x) => x.usdPrice && (x.liquidity || 0) >= 5000).map((x) => fromJup(x))
}

interface GeckoPool { attributes: { base_token_price_usd?: string; pool_created_at?: string; fdv_usd?: string | null; market_cap_usd?: string | null; price_change_percentage?: Record<string, string>; transactions?: { h24?: { buys?: number; sells?: number } }; volume_usd?: Record<string, string>; reserve_in_usd?: string; address: string }; relationships: { base_token: { data: { id: string } } } }
interface GeckoToken { id: string; attributes: { address: string; name: string; symbol: string; image_url?: string | null } }

const geckoCache = new Map<string, { at: number; list: MarketToken[] }>()

/** One page of GeckoTerminal pools → quotes (deduped by pool base token); the same page isn't refetched within 60 s */
async function geckoPage(net: string, kind: 'trending_pools' | 'new_pools', page: number): Promise<MarketToken[]> {
  const key = `${net}/${kind}/${page}`
  const hit = geckoCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.list
  // GeckoTerminal network name → our chain (chain field uses DexScreener chain keys); only chains we support
  const chain = chainByGecko(net)
  if (!chain) return []
  const chainKey = chain.dexKey
  const d = await fetchJson<{ data: GeckoPool[]; included?: GeckoToken[] }>(`https://api.geckoterminal.com/api/v2/networks/${net}/${kind}?page=${page}&include=base_token`)
  const tokens = new Map((d.included || []).map((x) => [x.id, x.attributes]))
  const out: MarketToken[] = []
  for (const p of d.data || []) {
    const a = p.attributes
    const tk = tokens.get(p.relationships.base_token.data.id)
    const price = Number(a.base_token_price_usd)
    if (!tk || !(price > 0)) continue
    const num = (v?: string | null) => (v == null || v === '' ? undefined : Number(v))
    out.push({ chain: chainKey, chainId: chain.id, address: tk.address, symbol: tk.symbol, name: tk.name,
      logo: tokenLogo(chainKey, tk.address, tk.image_url && !tk.image_url.includes('missing') ? tk.image_url : null),
      priceUsd: price, change1h: num(a.price_change_percentage?.h1), change6h: num(a.price_change_percentage?.h6), change24h: num(a.price_change_percentage?.h24),
      volume24h: num(a.volume_usd?.h24), liquidityUsd: num(a.reserve_in_usd), marketCap: num(a.market_cap_usd), fdv: num(a.fdv_usd),
      buys24h: a.transactions?.h24?.buys, sells24h: a.transactions?.h24?.sells, pairAddress: a.address,
      createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : undefined, url: `https://dexscreener.com/${chainKey}/${a.address}` })
  }
  geckoCache.set(key, { at: Date.now(), list: out })
  return out
}

/** Merging multiple sources: one entry per chain+token (first wins); one source failing doesn't affect the others */
async function mergeSources(sources: Promise<MarketToken[]>[]): Promise<MarketToken[]> {
  const settled = await Promise.allSettled(sources)
  const seen = new Set<string>()
  const out: MarketToken[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const tk of r.value) {
      const k = marketKey(tk.chain, tk.address)
      if (seen.has(k)) continue
      seen.add(k); out.push(tk)
    }
  }
  if (!out.length && settled.every((r) => r.status === 'rejected')) throw new Error(t('行情暂时无法加载'))
  return out
}

type RawPool = Omit<MarketToken, 'chainId' | 'logo'> & { logo: string | null }
/** Server-provided pools → quotes (fills in chainId / logo fallback / detail links); only chains we support */
function fromServer(list: RawPool[]): MarketToken[] {
  const out: MarketToken[] = []
  for (const x of list) {
    const chain = chainByDexKey(x.chain)
    if (!chain) continue
    out.push({ ...x, chainId: chain.id, logo: tokenLogo(x.chain, x.address, x.logo), url: `https://dexscreener.com/${x.chain}/${x.pairAddress}` })
  }
  return out
}

/** Server-aggregated multi-chain lists (kind: trending = hot pools / new = new pools).
 *  Without network = merged across the main-filter chains; with network (a GeckoTerminal network id) = that chain only — chains under "More" are pulled by the server on demand */
async function serverPools(kind: 'trending' | 'new', network?: string): Promise<MarketToken[]> {
  const d = await fetchJson<{ updatedAt: number; list: RawPool[] }>(`${API_BASE}/api/market/pools?kind=${kind}${network ? `&network=${encodeURIComponent(network)}` : ''}`)
  if (!d.list?.length && !network) throw new Error('empty')
  return fromServer(d.list)
}

/** Fallback when the server can't deliver: direct GeckoTerminal, but only the first page per chain to avoid rate limits again */
function directPools(kind: 'trending_pools' | 'new_pools'): Promise<MarketToken[]> {
  return mergeSources(['bsc', 'eth', 'base', 'robinhood'].map((n) => geckoPage(n, kind, 1)))
}

/** Fetch all resident chains at once: /api/market/pools/all (2026-09-26). Ready-made data from server memory — GeckoTerminal untouched.
 *  pending = chains the just-started server hasn't pulled in its first round yet (as DexScreener chain keys); the page shows "loading" based on it.
 *  When the server is still the old version (no such endpoint), fall back to the merged endpoint, then to GeckoTerminal's first page. */
async function fetchPoolsAll(kind: 'trending' | 'new'): Promise<FeedPart> {
  try {
    const d = await fetchJson<{ loading?: boolean; pending?: string[]; lists: Record<string, RawPool[]> }>(`${API_BASE}/api/market/pools/all?kind=${kind}`, {}, 8_000)
    const pending = (d.pending || []).map((g) => chainByGecko(g)?.dexKey).filter((x): x is string => !!x)
    return { list: fromServer(Object.values(d.lists || {}).flat()), pending }
  } catch {
    const list = await serverPools(kind).catch(() => directPools(kind === 'new' ? 'new_pools' : 'trending_pools'))
    return { list }
  }
}

/** One request shared per list kind within 10 s: Market and Hot both use hot pools, so switching views after entering Discover with prefetch doesn't refetch */
const poolsAllMemo = new Map<string, { at: number; p: Promise<FeedPart> }>()
export function serverPoolsAll(kind: 'trending' | 'new'): Promise<FeedPart> {
  const hit = poolsAllMemo.get(kind)
  if (hit && Date.now() - hit.at < 10_000) return hit.p
  const p = fetchPoolsAll(kind)
  poolsAllMemo.set(kind, { at: Date.now(), p })
  p.catch(() => { if (poolsAllMemo.get(kind)?.p === p) poolsAllMemo.delete(kind) })
  return p
}

/**
 * Data sources per Discover list (ordered by merge priority; the earlier source wins for the same token). marketFeed.runFeed runs them in parallel — first back shows first.
 *   Market: DexScreener hot + Jupiter hot 100 + per-chain hot pools
 *   Hot: DexScreener boosted + per-chain hot pools (sorted by 1h change)
 *   New: DexScreener latest profiles + per-chain new pools (sorted by listing time)
 *   Stocks: xStocks
 * Liquidity filtering and sorting live in marketFeed.finalizeFeed.
 */
export function feedSources(kind: FeedKind): Promise<FeedPart>[] {
  const part = (p: Promise<MarketToken[]>) => p.then((list): FeedPart => ({ list }))
  switch (kind) {
    case 'market': return [part(getTrending()), part(jupTrending()), serverPoolsAll('trending')]
    case 'hot': return [part(getBoosted()), serverPoolsAll('trending')]
    case 'new': return [part(getLatest()), serverPoolsAll('new')]
    case 'stocks': return [part(getStocks())]
  }
}

/**
 * Per-chain lists under "More" (fetched only when that chain is selected on Discover): the server pulls GeckoTerminal on demand, cached 60 s.
 * Market / Hot use hot pools, New uses new pools; same as other lists, only liquidity ≥ $5k survives. When the server can't deliver, don't go direct to GeckoTerminal (phones hit rate limits) — throw so the page shows retry.
 */
export async function getChainPools(kind: 'trending' | 'new', dexKey: string): Promise<MarketToken[]> {
  const chain = chainByDexKey(dexKey)
  if (!chain?.gecko) return []
  return (await serverPools(kind, chain.gecko)).filter((tk) => (tk.liquidityUsd || 0) >= 5000)
}
