// 行情数据源：DexScreener 公共接口（无需 API Key），支持全部链
// 接口失败时抛出异常，上层只标记离线，不用假数据顶上
import { API_BASE, ENV } from './env'
import { fetchJson } from './http'
import { MOCK_TOKENS, SOL_MINT, USDC_MINT } from './mock'
import { chainByDexKey, chainByGecko, tokenLogo, SOLANA_CHAIN_ID } from './chains'
import type { MarketToken } from './types'
import type { FeedKind, FeedPart } from './marketFeed'
import { t } from '@/lib/i18n'
import { assetForSymbol, mainstreamLookalike, normSymbol, officialAssetOf } from './officialTokens'

/** DexScreener 交易对结构（只声明用到的字段） */
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

/** 一个交易对 → 代币行情 */
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

/** 同一代币可能有多个交易对，按「链 + 地址」取流动性最高的那个；只保留我们支持交易的链 */
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

/** 批量获取某条链上代币行情（最多 30 个地址一批） */
export async function getTokens(addresses: string[], chain = 'solana'): Promise<MarketToken[]> {
  const uniq = [...new Set(addresses.filter(Boolean))]
  const chunks: string[][] = []
  for (let i = 0; i < uniq.length; i += 30) chunks.push(uniq.slice(i, i + 30))
  // 几批一起发（以前一批等一批，60 个地址要两个来回）
  const results = await Promise.all(chunks.map((chunk) => fetchJson<DsPair[]>(`${API}/tokens/v1/${chain}/${chunk.join(',')}`)))
  return results.flatMap((pairs) => bestPairs(pairs, chain))
}

export async function getToken(address: string, chain = 'solana'): Promise<MarketToken | undefined> {
  const list = await getTokens([address], chain)
  return list[0]
}

/** 只凭合约地址在所有链上查找（用于「添加代币」） */
export async function lookupAnyChain(address: string): Promise<MarketToken[]> {
  const res = await fetchJson<{ pairs: DsPair[] | null }>(`${API}/latest/dex/tokens/${encodeURIComponent(address.trim())}`)
  return bestPairs(res.pairs || []).sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0))
}

/** 热门代币：DexScreener 推广榜 + 主流代币，按 24h 成交量排序（Solana） */
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
 * 搜索结果（2026-09-30 goat：「搜 btc 出来这么多」「BTC、PEPE 的冒牌也要处理」）：
 *   tokens  要显示的：官方合约排最前（BNB Chain 的排第一）、标「官方」，其余按流动性 + 成交额排。
 *   以前还有一个 hidden（折叠的同名代币），2026-09-30 goat 定冒牌一律不显示、不再折叠，这个字段去掉了。
 */
export interface SearchResult { tokens: MarketToken[] }

/** 死池：流动性不到 5,000 美元、24 小时成交额也不到 1,000 美元（和行情页「流动性不低于 5,000 美元」同一口径） */
export const SEARCH_MIN_LIQUIDITY = 5_000
export const SEARCH_MIN_VOLUME = 1_000
/** 「新创建」：交易池创建不超过 3 天（搜索结果里标出来，风险较高） */
export const NEW_POOL_MS = 3 * 86_400_000
/** 同名的第二个起要显示，满足其一：成熟币（流动性 ≥ 5 万、池子超过 3 天、24h 成交 ≥ 1 万美元）或新币（池子 3 天内、24h 成交 ≥ 1 万美元且 ≥ 100 笔） */
export const SAME_NAME_MIN_LIQUIDITY = 50_000
export const SAME_NAME_MIN_VOLUME = 10_000
export const SAME_NAME_MIN_TXNS = 100
const SEARCH_LIMIT = 30

/** 搜的是不是合约地址（EVM 0x 开头 40 位，或 Solana base58 32~44 位） */
export const isAddressQuery = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q.trim()) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim())

/** 综合分：流动性 + 一半的 24 小时成交额（成交额高说明真有人在交易，但比流动性容易刷） */
const searchScore = (x: MarketToken) => (x.liquidityUsd || 0) + (x.volume24h || 0) / 2

/** 交易池是不是 3 天内刚创建的（拿不到创建时间的不算） */
export const isNewPool = (x: Pick<MarketToken, 'createdAt'>, now = Date.now()) => !!x.createdAt && now - x.createdAt <= NEW_POOL_MS

/** 同名的第二个起能不能显示：成熟币看流动性 + 成交额，新币看成交额 + 成交笔数（有真实交易的新币不挡） */
export function sameNameVisible(x: MarketToken, now = Date.now()): boolean {
  const vol = x.volume24h || 0
  if (vol < SAME_NAME_MIN_VOLUME) return false
  if (isNewPool(x, now)) return (x.buys24h || 0) + (x.sells24h || 0) >= SAME_NAME_MIN_TXNS
  return !!x.createdAt && (x.liquidityUsd || 0) >= SAME_NAME_MIN_LIQUIDITY
}

/**
 * 把搜到的币排好、过滤（纯函数，方便单测）：
 *   · 官方表里有的币（手写主流币 / 稳定币 + 市值前 200）：只显示官方合约，符号相同（或 ERC20-USDT 这类冒充写法）的非官方合约一律不显示。
 *   · 不在官方表里的普通币：同一个符号里分数最高的照常显示（只过死池）；第二个起按 sameNameVisible 的门槛，达不到的不显示。
 *   · 非官方、交易池 3 天内刚创建的标 fresh（界面显示「新创建」）。
 *   · 粘贴合约地址：用户明确要那个币，不过滤，冒充主流币的标 impostor（界面显示「非官方」）。
 */
export function rankSearch(list: MarketToken[], q: string, now = Date.now()): SearchResult {
  // 同一个币可能从两路来（搜索接口 + 官方表直查），按「链 + 地址」去重，留流动性高的那份
  const byKey = new Map<string, MarketToken>()
  for (const x of list) {
    const k = marketKey(x.chain, x.address)
    const prev = byKey.get(k)
    if (!prev || (x.liquidityUsd || 0) > (prev.liquidityUsd || 0)) byKey.set(k, x)
  }
  const all = [...byKey.values()].map((x) => {
    const official = !!officialAssetOf(x.chain, x.address)
    const like = official ? undefined : mainstreamLookalike(x.symbol)
    // 宽松资产（自动收录的短符号）撞名的不算冒牌
    return { ...x, official, impostor: !!like && !like.loose, fresh: !official && isNewPool(x, now) }
  })
  // 搜的是官方表里的币（usdt / btc / pepe…）：只要这一种币（搜 usdt 时 USDC、AIPF 这类只是和 USDT 配对的币不显示）
  const asset = isAddressQuery(q) ? undefined : assetForSymbol(q.trim())
  const officials = all.filter((x) => x.official && (!asset || officialAssetOf(x.chain, x.address) === asset))
    .sort((a, b) => Number(b.chain === 'bsc') - Number(a.chain === 'bsc') || searchScore(b) - searchScore(a))
  const rest = all.filter((x) => !x.official).sort((a, b) => searchScore(b) - searchScore(a))
  if (isAddressQuery(q)) return { tokens: [...officials, ...rest].slice(0, SEARCH_LIMIT) }

  const shown: MarketToken[] = []
  const seen = new Set<string>()
  // 搜的是宽松资产（AI、LIT 这类短符号）：官方的已经排在最前，同名的别家算「第二个起」，要过同名门槛才显示
  if (asset?.loose) seen.add(normSymbol(asset.symbol))
  for (const x of rest) {
    // 官方表里有的币的非官方合约（冒牌）：不显示（2026-09-30 goat）
    if (x.impostor) continue
    // 搜的是官方表里的币，其余不相干的也不显示（宽松资产只留同名的）
    if (asset && (!asset.loose || normSymbol(x.symbol) !== normSymbol(asset.symbol))) continue
    if ((x.liquidityUsd || 0) < SEARCH_MIN_LIQUIDITY && (x.volume24h || 0) < SEARCH_MIN_VOLUME) continue
    const k = normSymbol(x.symbol)
    if (seen.has(k) && !sameNameVisible(x, now)) continue
    seen.add(k)
    shown.push({ ...x, impostor: false })
  }
  return { tokens: [...officials, ...shown].slice(0, SEARCH_LIMIT) }
}

/** 搜索：名称、符号或合约地址，所有支持的链。搜的是主流币（btc / eth / usdt…）时，官方合约直接按地址查一遍，保证一定在结果里 */
export async function searchTokensGrouped(q: string): Promise<SearchResult> {
  const query = q.trim()
  if (!query) return { tokens: [] }
  const asset = assetForSymbol(query)
  const byChain = new Map<string, string[]>()
  for (const [c, a] of asset?.tokens ?? []) byChain.set(c, [...(byChain.get(c) || []), a])
  const [res, ...officials] = await Promise.all([
    fetchJson<{ pairs: DsPair[] | null }>(`${API}/latest/dex/search?q=${encodeURIComponent(query)}`),
    // 官方表直查失败不影响搜索本身
    ...[...byChain].map(([c, addrs]) => getTokens(addrs, c).catch(() => [] as MarketToken[])),
  ])
  return rankSearch([...officials.flat(), ...bestPairs(res.pairs || [])], query)
}

/** 只要正常显示的那部分（老调用点用） */
export async function searchTokens(q: string): Promise<MarketToken[]> {
  return (await searchTokensGrouped(q)).tokens
}

/** SOL 价格（美元） */
export async function getSolPrice(): Promise<number> {
  const t = await getToken(SOL_MINT)
  return t?.priceUsd || 0
}

export { SOL_MINT, USDC_MINT }


/** 把 DexScreener 的「链 + 地址」清单按链批量拉成行情，保持原顺序、去重、只留我们支持的链 */
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

/** 火热：DexScreener 加速榜（项目方付费推广的币，热度真实存在但不代表质量），按链拉行情 */
export async function getBoosted(): Promise<MarketToken[]> {
  const items = await fetchJson<{ chainId: string; tokenAddress: string; totalAmount?: number }[]>(`${API}/token-boosts/top/v1`)
  return resolveList(items)
}

/** 最新：DexScreener 最新登记档案的代币，过滤掉流动性太低的空气盘 */
export async function getLatest(): Promise<MarketToken[]> {
  const items = await fetchJson<{ chainId: string; tokenAddress: string }[]>(`${API}/token-profiles/latest/v1`)
  return (await resolveList(items)).filter((t) => (t.liquidityUsd || 0) >= 5000)
}

/** 股票代币：xStocks（Backed 发行的代币化美股 / ETF）。清单来自 xstocks.com（scripts/fetch-xstocks.mjs → public/xstocks.json），
 *  行情用 Jupiter 按 mint 批量查（每次 100 个），只留有流动性的，按 24h 成交额排 */
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
// 更多数据源（2026-09-25 goat 反馈发现页只有十几个币）。
// ⚠️ 同日真机又发现只剩 Solana：GeckoTerminal 免费档每 IP 每分钟 30 次，每台手机自己拉切几次标签就 429。
//    改成优先读我们服务器汇总好的 /api/market/pools（server/src/marketLists.ts，服务器慢慢拉、缓存），
//    服务器没有这个接口时才退回直连，而且只拉少量几页。
// DexScreener 的推广榜 / 最新榜每次只给 30 个，再按流动性一滤就剩十几个。补两个免费源：
//   · Jupiter 24h 热门榜：Solana，一次 100 个，带价格 / 流动性 / 成交
//   · GeckoTerminal：各链热门池 / 新池，每页 20 个，可翻页（免费档每分钟 30 次，这里带 60 秒缓存）
// ---------------------------------------------------------------------------

interface JupToken { id: string; symbol: string; name: string; icon?: string; usdPrice?: number; liquidity?: number; mcap?: number; fdv?: number; stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number }; stats1h?: { priceChange?: number }; stats6h?: { priceChange?: number }; stats5m?: { priceChange?: number }; firstPool?: { createdAt?: string } }

function fromJup(x: JupToken, logo?: string): MarketToken {
  return { chain: 'solana', chainId: SOLANA_CHAIN_ID, address: x.id, symbol: x.symbol, name: x.name, logo: [logo, x.icon].filter(Boolean).join('|'),
    priceUsd: x.usdPrice || 0, change5m: x.stats5m?.priceChange, change1h: x.stats1h?.priceChange, change6h: x.stats6h?.priceChange, change24h: x.stats24h?.priceChange,
    volume24h: (x.stats24h?.buyVolume || 0) + (x.stats24h?.sellVolume || 0), liquidityUsd: x.liquidity, marketCap: x.mcap, fdv: x.fdv, buys24h: x.stats24h?.numBuys, sells24h: x.stats24h?.numSells,
    createdAt: x.firstPool?.createdAt ? Date.parse(x.firstPool.createdAt) : undefined, url: `https://dexscreener.com/solana/${x.id}` }
}

/** Jupiter 24h 热门榜（Solana，最多 100 个） */
async function jupTrending(): Promise<MarketToken[]> {
  const list = await fetchJson<JupToken[]>('https://lite-api.jup.ag/tokens/v2/toptrending/24h?limit=100')
  return list.filter((x) => x.usdPrice && (x.liquidity || 0) >= 5000).map((x) => fromJup(x))
}

interface GeckoPool { attributes: { base_token_price_usd?: string; pool_created_at?: string; fdv_usd?: string | null; market_cap_usd?: string | null; price_change_percentage?: Record<string, string>; transactions?: { h24?: { buys?: number; sells?: number } }; volume_usd?: Record<string, string>; reserve_in_usd?: string; address: string }; relationships: { base_token: { data: { id: string } } } }
interface GeckoToken { id: string; attributes: { address: string; name: string; symbol: string; image_url?: string | null } }

const geckoCache = new Map<string, { at: number; list: MarketToken[] }>()

/** 一页 GeckoTerminal 池子 → 行情（按池子的基础币去重），60 秒内同一页不重复请求 */
async function geckoPage(net: string, kind: 'trending_pools' | 'new_pools', page: number): Promise<MarketToken[]> {
  const key = `${net}/${kind}/${page}`
  const hit = geckoCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.list
  // GeckoTerminal 网络名 → 我们的链（chain 字段用 DexScreener 链标识），只收我们支持的链
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

/** 多个来源合并：同一条链同一个币只留一条（先到先得），其中一个源挂了不影响其它 */
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
/** 服务器给的池子 → 行情（补 chainId / logo 备选 / 详情链接），只留我们支持的链 */
function fromServer(list: RawPool[]): MarketToken[] {
  const out: MarketToken[] = []
  for (const x of list) {
    const chain = chainByDexKey(x.chain)
    if (!chain) continue
    out.push({ ...x, chainId: chain.id, logo: tokenLogo(x.chain, x.address, x.logo), url: `https://dexscreener.com/${x.chain}/${x.pairAddress}` })
  }
  return out
}

/** 服务器汇总的多链榜单（kind: trending 热门池 / new 新池）。
 *  不带 network = 主筛选各链合并；带 network（GeckoTerminal 网络 id）= 只要这一条链，「更多」里的链由服务器按需拉 */
async function serverPools(kind: 'trending' | 'new', network?: string): Promise<MarketToken[]> {
  const d = await fetchJson<{ updatedAt: number; list: RawPool[] }>(`${API_BASE}/api/market/pools?kind=${kind}${network ? `&network=${encodeURIComponent(network)}` : ''}`)
  if (!d.list?.length && !network) throw new Error('empty')
  return fromServer(d.list)
}

/** 服务器拿不到时的退路：直连 GeckoTerminal，但每条链只拉第一页，免得又被限流 */
function directPools(kind: 'trending_pools' | 'new_pools'): Promise<MarketToken[]> {
  return mergeSources(['bsc', 'eth', 'base', 'robinhood'].map((n) => geckoPage(n, kind, 1)))
}

/** 常驻各链一次拿齐：/api/market/pools/all（2026-09-26）。服务器内存里现成的数据，不碰 GeckoTerminal。
 *  pending = 服务器刚启动、首轮还没拉到的链（换成 DexScreener 链标识），页面据此显示「正在读取中」。
 *  服务器还是旧版（没有这个接口）时退回合并接口，再不行直连 GeckoTerminal 第一页。 */
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

/** 同一种榜单 10 秒内共用一个请求：市场和火热都用热门池，进发现页预取后切视图不再重复拉 */
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
 * 发现页各榜单的数据源（按合并优先级排，同一个币用排前面的源）。交给 marketFeed.runFeed 并行跑，谁先回来先显示。
 *   市场：DexScreener 热门 + Jupiter 热门 100 + 各链热门池
 *   火热：DexScreener 推广榜 + 各链热门池（按 1 小时涨跌幅度排）
 *   最新：DexScreener 最新登记 + 各链新池（按上线时间排）
 *   股票：xStocks
 * 流动性过滤和排序在 marketFeed.finalizeFeed。
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
 * 「更多」里某条链的榜单（发现页选中这条链时才拉）：服务器按需向 GeckoTerminal 要、缓存 60 秒。
 * 市场 / 火热用热门池，最新用新池；和其它榜单一样只留流动性 ≥ $5k 的。服务器拿不到时不直连 GeckoTerminal（手机直连会撞限流），直接报错让页面显示重试。
 */
export async function getChainPools(kind: 'trending' | 'new', dexKey: string): Promise<MarketToken[]> {
  const chain = chainByDexKey(dexKey)
  if (!chain?.gecko) return []
  return (await serverPools(kind, chain.gecko)).filter((tk) => (tk.liquidityUsd || 0) >= 5000)
}
