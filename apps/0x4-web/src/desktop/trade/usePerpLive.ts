// 合约终端的实时数据：盘口、最新成交、合约头部（标记价 / 指数价 / 资金费率 / 下次结算 / 24h 统计 / 持仓量）。
// · 优先 websocket 合并流（lib/asterBook.ts）；连不上或断了就先 1.5 秒轮询一次 REST，同时按 5 秒、10 秒……最长 60 秒重连
// · 标签页切到后台：关掉连接、停掉轮询；切回来先拉一次快照再重连
// · 推送很密（热门币逐笔一秒十几条），攒 200 毫秒刷新一次界面
// · 持仓量没有推送，15 秒拉一次
// · 大单（2026-10-02，lib/perpFlow.ts）：打开时回补最近 1000 笔成交、据此定这个币的大单门槛，之后推送 / 轮询来的成交过了门槛就记下
// 全是真实数据：拿不到的项就是 undefined，页面显示 --。
import { useEffect, useState } from 'react'
import { loadBook, loadOpenInterestUsd, loadPerpStats, loadTape, mergeTape, parseStream, streamUrl, type OrderBook, type PerpStats, type TapeTrade } from '@/lib/asterBook'
import { bigThreshold, mergeBig, pickBig, type BigTrade } from '@/lib/perpFlow'

export type LiveMode = 'loading' | 'live' | 'poll' | 'error'
export interface PerpLive {
  book: OrderBook | null; tape: TapeTrade[]; stats: PerpStats; mode: LiveMode
  /** 大单（按时间从早到晚）、大单门槛（美元，0 = 还没回补到）、从什么时候起有记录（毫秒） */
  big: BigTrade[]; bigMin: number; bigSince: number
}

const EMPTY: PerpLive = { book: null, tape: [], stats: {}, mode: 'loading', big: [], bigMin: 0, bigSince: 0 }

export function usePerpLive(coin: string, retry = 0): PerpLive {
  const [s, set] = useState<PerpLive>(EMPTY)

  useEffect(() => {
    if (!coin) return
    let alive = true
    let ws: WebSocket | null = null
    let pollId = 0, reconnectId = 0, flushId = 0, oiId = 0, fails = 0
    let book: OrderBook | null = null
    let tape: TapeTrade[] = []
    let stats: PerpStats = {}
    let mode: LiveMode = 'loading'
    let big: BigTrade[] = [], bigMin = 0, bigSince = 0, backfilling = false
    set(EMPTY)

    const flush = () => { flushId = 0; if (alive) set({ book, tape, stats, mode, big, bigMin, bigSince }) }
    const soon = () => { if (!flushId) flushId = window.setTimeout(flush, 200) }
    const setMode = (m: LiveMode) => { if (mode !== m) { mode = m; flush() } }

    /** 新来的成交里过了门槛的记成大单（门槛还没定时不记，回补会把它们一起带回来） */
    const noteBig = (trades: TapeTrade[]) => { if (bigMin > 0) big = mergeBig(big, pickBig(trades, bigMin)) }
    /** 回补最近 1000 笔：定门槛 + 把这段时间里的大单找出来。失败了下次切回页面 / 重连时再试 */
    const backfill = async () => {
      if (bigMin > 0 || backfilling) return
      backfilling = true
      try {
        const rows = await loadTape(coin, 1000)
        if (!alive || !rows.length) return
        bigMin = bigThreshold(rows)
        bigSince = rows[rows.length - 1].time
        // 请求在路上的这一小段时间里推送来的成交不在 rows 里：从手上的最新成交里补一遍
        big = mergeBig(mergeBig(big, pickBig(rows, bigMin)), pickBig(tape, bigMin))
        soon()
      } catch { /* 大单是锦上添花：拿不到就不画，不影响盘口 */ } finally { backfilling = false }
    }

    /** REST 快照：盘口 + 逐笔 + 头部。返回盘口拿没拿到 */
    const snapshot = async (withStats: boolean) => {
      const [b, tp, st] = await Promise.allSettled([loadBook(coin), loadTape(coin), withStats ? loadPerpStats(coin) : Promise.resolve(null)])
      if (!alive) return false
      if (b.status === 'fulfilled') book = b.value
      if (tp.status === 'fulfilled') { tape = mergeTape(tape, tp.value); noteBig(tp.value) }
      if (st.status === 'fulfilled' && st.value) stats = { ...stats, ...st.value }
      if (!book && b.status === 'rejected' && mode !== 'live') mode = 'error'
      flush()
      return b.status === 'fulfilled'
    }
    const stopPoll = () => { if (pollId) { window.clearInterval(pollId); pollId = 0 } }
    const startPoll = () => {
      if (pollId || !alive) return
      if (book) setMode('poll')
      pollId = window.setInterval(() => { if (!document.hidden) void snapshot(false) }, 1500)
    }
    const closeWs = () => { if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close() } catch { /* 已经关了 */ } ws = null } }
    const connect = () => {
      window.clearTimeout(reconnectId); reconnectId = 0
      if (!alive || document.hidden) return
      if (typeof WebSocket === 'undefined') { startPoll(); return }
      closeWs()
      try { ws = new WebSocket(streamUrl(coin)) } catch { startPoll(); return }
      ws.onopen = () => { fails = 0; stopPoll(); setMode('live') }
      ws.onmessage = (e) => {
        const m = parseStream(String(e.data))
        if (!m) return
        if (m.book) book = m.book
        if (m.trade) { tape = mergeTape(tape, [m.trade]); noteBig([m.trade]) }
        if (m.stats) stats = { ...stats, ...Object.fromEntries(Object.entries(m.stats).filter(([, v]) => v !== undefined)) }
        soon()
      }
      // 出错后浏览器一定会接着触发 close，统一在 close 里退回轮询、排队重连
      ws.onclose = () => {
        ws = null
        if (!alive || document.hidden) return
        startPoll()
        fails++
        reconnectId = window.setTimeout(connect, Math.min(60_000, 5000 * fails))
      }
    }
    const pullOi = () => {
      const mark = stats.mark || stats.last || 0
      if (document.hidden || !(mark > 0)) return
      loadOpenInterestUsd(coin, mark).then((v) => { if (alive && v !== undefined) { stats = { ...stats, openInterest: v }; soon() } }).catch(() => { /* 持仓量拿不到就显示 -- */ })
    }
    const onVisible = () => {
      if (document.hidden) { closeWs(); stopPoll(); window.clearTimeout(reconnectId); reconnectId = 0; return }
      void snapshot(true)
      void backfill()
      connect()
    }

    void snapshot(true)
    void backfill()
    connect()
    oiId = window.setInterval(pullOi, 15_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      closeWs(); stopPoll()
      window.clearTimeout(reconnectId); window.clearTimeout(flushId); window.clearInterval(oiId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [coin, retry])

  return s
}
