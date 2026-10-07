// 首页今日盈亏（账本规则见 lib/dayPnl.ts）：首页每次刷新完余额记一次读数，合约部分向服务器要（用手动合约授权过的只读代理读）。
// 账本按账户存在本机；0 点价向服务器要（服务器 0 点给最近 7 天有人持有的币记价），所以要先把自己持有哪些币（不含数量）登记给服务器。
import { create } from 'zustand'
import { api } from '@/lib/social'
import { observe, startOfDayCst, type Ledger, type Obs, type PerpPart } from '@/lib/dayPnl'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, isStable } from '@/lib/chains'
import type { Holding } from '@/lib/types'
import { usePortfolio } from './portfolio'
import { useSocial } from './social'
import { useWallet } from './wallet'

const STORE_KEY = '0x4.daypnl.v1:'
const WATCH_EVERY = 10 * 60_000
const PERP_EVERY = 60_000
const MAX_TOKENS = 200

/** 和服务器同一个写法：链 id:代币地址，EVM / 比特币小写，Solana 原样 */
export const assetKey = (chainId: number, token: string) => `${chainId}:${chainId === SOLANA_CHAIN_ID ? token : token.toLowerCase()}`
const chainOf = (key: string) => Number(key.slice(0, key.indexOf(':')))

function loadLedger(account: string): Ledger | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY + account) || 'null') as Ledger | null
    return v && v.v === 1 && typeof v.day === 'number' && v.last && typeof v.last === 'object' ? { ...v, pending: v.pending || {}, partial: v.partial || [] } : null
  } catch { return null }
}
function saveLedger(account: string, L: Ledger) {
  try { localStorage.setItem(STORE_KEY + account, JSON.stringify(L)) } catch { /* 无痕模式：只在这次打开期间有效 */ }
}

/** 服务器记的某天 0 点价（要登录，只有价格）；拿不到返回 null，这些币从今天第一次读到时起算 */
async function fetchOpen(day: number, keys: string[]): Promise<Record<string, number> | null> {
  if (!keys.length) return {}
  try {
    const r = await api<{ prices?: Record<string, number> }>(`/api/pnl/open?day=${day}&tokens=${encodeURIComponent(keys.slice(0, MAX_TOKENS).join(','))}`)
    return r.prices || {}
  } catch { return null }
}

interface DayPnlState {
  account: string
  ledger: Ledger | null
  /** null = 合约读不到（没授权只读代理、没入金、接口失败），界面不显示合约部分 */
  perp: PerpPart | null
  perpAt: number
  /** 已经记过的那次余额刷新（usePortfolio.lastUpdated） */
  seen: number
  watchAt: number
  update: () => Promise<void>
}

let running: Promise<void> | null = null

export const useDayPnl = create<DayPnlState>((set, get) => ({
  account: '',
  ledger: null,
  perp: null,
  perpAt: 0,
  seen: 0,
  watchAt: 0,

  update() {
    if (running) return running
    running = (async () => {
      const account = useWallet.getState().address || ''
      if (!account) return
      if (get().account !== account) set({ account, ledger: loadLedger(account), perp: null, perpAt: 0, seen: 0, watchAt: 0 })
      const pf = usePortfolio.getState()
      const now = Date.now()
      const ready = useSocial.getState().status === 'ready'

      if (pf.lastUpdated > 0 && pf.lastUpdated !== get().seen) {
        const list: Holding[] = pf.btc && pf.btcFresh ? [...pf.holdings, pf.btc] : pf.holdings
        const assets: Obs[] = list.map((h) => ({ key: assetKey(h.chainId, h.mint), q: h.amount, p: h.priceUsd, stable: isStable(h.symbol) }))
        const scanned = new Set(pf.scannedChains)
        if (pf.btcFresh) scanned.add(BTC_CHAIN_ID)
        const prev = get().ledger
        const day = startOfDayCst(now)
        let open: Record<string, number> | null = null
        if (prev && prev.day !== day) {
          const keys = [...Object.entries(prev.last).filter(([, e]) => e.q > 0 && !e.s).map(([k]) => k), ...Object.keys(prev.pending)]
          open = await fetchOpen(day, keys)
        }
        // 等价格期间账户可能切换了：切换了就不记这次
        if (useWallet.getState().address !== account) return
        const L = observe(prev, { now, assets, fresh: (k) => scanned.has(chainOf(k)), open })
        saveLedger(account, L)
        set({ ledger: L, seen: pf.lastUpdated })

        // 登记持有的币（稳定币不用记价），好让服务器 0 点给它们记价格
        if (ready && now - get().watchAt > WATCH_EVERY) {
          const tokens = list.filter((h) => h.amount > 0 && !isStable(h.symbol)).slice(0, MAX_TOKENS).map((h) => ({ chainId: h.chainId, token: h.mint }))
          set({ watchAt: now })
          if (tokens.length) api('/api/pnl/watch', { method: 'POST', body: JSON.stringify({ tokens }) }).catch(() => set({ watchAt: 0 }))
        }
      }

      if (ready && now - get().perpAt > PERP_EVERY) {
        set({ perpAt: now })
        try {
          const r = await api<{ available: boolean } & Partial<PerpPart>>('/api/pnl/perp')
          if (useWallet.getState().address !== account) return
          const ok = r.available && [r.pnl, r.base, r.netIn, r.equity, r.since].every((v) => typeof v === 'number' && Number.isFinite(v))
          set({ perp: ok ? { pnl: r.pnl!, base: r.base!, netIn: r.netIn!, equity: r.equity!, since: r.since! } : null })
        } catch { set({ perp: null }) }
      }
    })().finally(() => { running = null })
    return running
  },
}))
