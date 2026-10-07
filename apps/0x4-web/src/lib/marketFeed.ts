// 发现页榜单的纯逻辑（2026-09-26，老板反馈切链慢、加载中显示「暂无行情」）。
// 这里不发请求、不碰 React，只管：几个数据源陆续回来时怎么合并、本地快照怎么存取、某条链当前该显示列表 / 正在读取 / 读取失败 / 暂无行情。
// 请求在 lib/market.ts 的 feedSources，状态在 store/discoverFeed.ts。
import type { MarketToken } from './types'

export type FeedKind = 'market' | 'hot' | 'new' | 'stocks'

/** 一个数据源的一次结果。pending = 服务器说首轮还没拉到的链（DexScreener 链标识），只有我们服务器的榜单会带 */
export interface FeedPart { list: MarketToken[]; pending?: string[] }

/** 一份榜单在页面上的状态 */
export interface Feed {
  list: MarketToken[]
  /** 最近一次拿到数据的时间，0 = 从没拿到过 */
  at: number
  /** 服务器还在读的链 */
  pending: string[]
  /** 正在拉（数据源没全部回来） */
  loading: boolean
  /** 上一次所有数据源都失败了 */
  error: boolean
  /** 上一次有数据源失败（按链筛选后为空时算读取失败，不算暂无） */
  partialError: boolean
  /** 列表来自上次打开 App 存的快照，这次还没刷新成功过（快照只存了前几百条，某条链为空不代表真的没有） */
  fromSnapshot?: boolean
}

export const EMPTY_FEED: Feed = { list: [], at: 0, pending: [], loading: false, error: false, partialError: false }

const key = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`
const MIN_LIQUIDITY = 5000

/** 各榜单的收尾：市场 / 火热 / 最新只留流动性 ≥ $5k 的，再按各自规则排；股票源头已经排好 */
export function finalizeFeed(kind: FeedKind, list: MarketToken[]): MarketToken[] {
  if (kind === 'stocks') return list
  const liquid = list.filter((tk) => (tk.liquidityUsd || 0) >= MIN_LIQUIDITY)
  if (kind === 'hot') return liquid.sort((a, b) => Math.abs(b.change1h ?? 0) - Math.abs(a.change1h ?? 0))
  if (kind === 'new') return liquid.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return liquid.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
}

/** 按数据源的固定顺序合并（不按谁先回来），同一条链同一个币只留排在前面的源给的那条 */
export function mergeParts(parts: (FeedPart | undefined)[]): MarketToken[] {
  const seen = new Set<string>()
  const out: MarketToken[] = []
  for (const p of parts) {
    if (!p) continue
    for (const tk of p.list) {
      const k = key(tk.chain, tk.address)
      if (seen.has(k)) continue
      seen.add(k); out.push(tk)
    }
  }
  return out
}

export interface FeedProgress { list: MarketToken[]; pending: string[]; done: boolean; failed: boolean; partialFailed: boolean }

/**
 * 几个数据源并行，谁回来就先把已有的合并交出去，不等最慢的那个。
 * 以前 mergeSources 要等全部回来（DexScreener 逐链补行情 + Jupiter 要 2~4 秒），我们服务器的榜单 0.4 秒就到了也得陪着等。
 *
 * finalize = 过滤 + 排序（各榜单见 finalizeFeed）。
 * previous = 页面上正在显示的旧列表：没全部回来之前，新数据盖在旧数据上面交出去（同一个币用新的），旧的先垫着不闪；全部回来后旧的丢掉。
 */
export function runFeed(finalize: (list: MarketToken[]) => MarketToken[], sources: Promise<FeedPart>[], onUpdate: (p: FeedProgress) => void, previous: MarketToken[] = []): Promise<FeedProgress> {
  const parts: (FeedPart | undefined)[] = sources.map(() => undefined)
  let settled = 0
  let failures = 0
  return new Promise((resolve) => {
    if (!sources.length) { const p = { list: [], pending: [], done: true, failed: false, partialFailed: false }; onUpdate(p); resolve(p); return }
    const emit = () => {
      const done = settled === sources.length
      const pending = [...new Set(parts.flatMap((p) => p?.pending ?? []))]
      const merged = mergeParts(done ? parts : [...parts, { list: previous }])
      const p: FeedProgress = { list: finalize(merged), pending, done, failed: done && failures === sources.length, partialFailed: failures > 0 }
      onUpdate(p)
      if (done) resolve(p)
    }
    sources.forEach((src, i) => {
      src.then((part) => { parts[i] = part }, () => { failures++ })
        .finally(() => { settled++; emit() })
    })
  })
}

/** 按链筛选：all = 全部 */
export const filterChain = (list: MarketToken[], chain: string) => (chain === 'all' ? list : list.filter((tk) => tk.chain === chain))

/** 列表区域该显示什么：有数据就显示列表；没数据时按「还在读 → 失败 → 真的没有」的顺序判断 */
export type ListState = 'list' | 'loading' | 'error' | 'empty'
export function listState(o: { count: number; loading: boolean; error: boolean }): ListState {
  if (o.count > 0) return 'list'
  if (o.loading) return 'loading'
  if (o.error) return 'error'
  return 'empty'
}

/**
 * 某条链在这份榜单里是否还算「正在读取」（只在列表为空时用得上）：
 * 从没拿到过；上次失败了正在重拉；或服务器说这条链首轮还没拉完。
 * 已经拿到过、只是 30 秒一次的后台刷新，不算（不然真没数据的链会在「正在读取中」和「暂无行情」之间来回闪）。
 */
export function feedLoading(feed: Feed, chain: string): boolean {
  if (feed.at === 0 && !feed.error && !feed.partialError) return true
  if (feed.fromSnapshot) return true
  if (feed.loading && (feed.at === 0 || feed.error || feed.partialError)) return true
  return chain === 'all' ? feed.pending.length > 0 && !feed.list.length : feed.pending.includes(chain)
}

/** 按链筛选后为空时算不算读取失败 */
export function feedFailed(feed: Feed, chain: string): boolean {
  return chain === 'all' ? feed.error : feed.error || feed.partialError
}

// ── 本地快照：App 重开先显示上次的榜单，再悄悄刷新 ──

const PREFIX = '0x4.discover.v1.'
/** 超过 6 小时的快照不拿出来，太旧的价格会误导人 */
export const SNAPSHOT_MAX_AGE = 6 * 3600_000
/** 每份最多存这么多条，省 localStorage */
export const SNAPSHOT_MAX_ITEMS = 300

interface Snapshot { at: number; list: MarketToken[] }

export function readSnapshot(name: string, now = Date.now()): Snapshot | null {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (!raw) return null
    const s = JSON.parse(raw) as Snapshot
    if (!s || typeof s.at !== 'number' || !Array.isArray(s.list)) return null
    if (now - s.at > SNAPSHOT_MAX_AGE) return null
    return s
  } catch { return null }
}

export function writeSnapshot(name: string, list: MarketToken[], at = Date.now()): void {
  // 描述文字很长又用不到，不存
  const slim = list.slice(0, SNAPSHOT_MAX_ITEMS).map(({ description: _d, ...tk }) => tk)
  try { localStorage.setItem(PREFIX + name, JSON.stringify({ at, list: slim })) } catch { /* 存不上就下次重新拉，不影响使用 */ }
}

/** 快照 → 页面初始状态（没有快照就是从没拿到过） */
export function feedFromSnapshot(name: string, now = Date.now()): Feed {
  const s = readSnapshot(name, now)
  return s ? { ...EMPTY_FEED, list: s.list, at: s.at, fromSnapshot: true } : EMPTY_FEED
}

/** 多久内不重复拉：服务器说有链还在读时 4 秒一查，平时 30 秒 */
export function isFresh(feed: Feed, now = Date.now(), maxAge = 30_000): boolean {
  if (!feed.at || feed.error || feed.fromSnapshot) return false
  return now - feed.at < (feed.pending.length ? 4_000 : maxAge)
}
