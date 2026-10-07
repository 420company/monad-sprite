// Perp terminal live data: order book, latest trades, contract header (mark / index price, funding rate, next settlement, 24h stats, open interest).
// · Prefer the websocket combined stream (lib/asterBook.ts); when it can't connect or drops, poll REST every 1.5 s first, while reconnecting with 5 s, 10 s, … backoff up to 60 s
// · Tab backgrounded: close the connection, stop polling; on return, pull one snapshot before reconnecting
// · Pushes are dense (a dozen+ trades/sec on hot tokens) — batch them into one UI refresh every 200 ms
// · Open interest has no push — pull every 15 s
// · Whale trades (2026-10-02, lib/perpFlow.ts): on open, backfill the latest 1000 trades to set this token's whale threshold; later pushed / polled trades above the threshold get recorded
// All real data: unavailable fields stay undefined, shown as -- on the page.
import { useEffect, useState } from 'react'
import { loadBook, loadOpenInterestUsd, loadPerpStats, loadTape, mergeTape, parseStream, streamUrl, type OrderBook, type PerpStats, type TapeTrade } from '@/lib/asterBook'
import { bigThreshold, mergeBig, pickBig, type BigTrade } from '@/lib/perpFlow'

export type LiveMode = 'loading' | 'live' | 'poll' | 'error'
export interface PerpLive {
  book: OrderBook | null; tape: TapeTrade[]; stats: PerpStats; mode: LiveMode
  /** Whale trades (oldest first), whale threshold (USD; 0 = backfill not done yet), records-since timestamp (ms) */
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

    /** Incoming trades above the threshold are recorded as whale trades (nothing recorded before the threshold is set — the backfill brings them along) */
    const noteBig = (trades: TapeTrade[]) => { if (bigMin > 0) big = mergeBig(big, pickBig(trades, bigMin)) }
    /** Backfill the latest 1000 trades: set the threshold + find that window's whale trades. On failure, retry next time the page is revisited / reconnected */
    const backfill = async () => {
      if (bigMin > 0 || backfilling) return
      backfilling = true
      try {
        const rows = await loadTape(coin, 1000)
        if (!alive || !rows.length) return
        bigMin = bigThreshold(rows)
        bigSince = rows[rows.length - 1].time
        // Trades pushed while the request was in flight aren't in rows: patch them in from the latest trades on hand
        big = mergeBig(mergeBig(big, pickBig(rows, bigMin)), pickBig(tape, bigMin))
        soon()
      } catch { /* Whale trades are a nice-to-have: skip drawing when unavailable — the book is unaffected */ } finally { backfilling = false }
    }

    /** REST snapshot: book + trades + header. Returns whether the book was obtained */
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
    const closeWs = () => { if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close() } catch { /* Already closed */ } ws = null } }
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
      // Browsers always fire close after an error, so falling back to polling and queueing reconnects is unified in close
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
      loadOpenInterestUsd(coin, mark).then((v) => { if (alive && v !== undefined) { stats = { ...stats, openInterest: v }; soon() } }).catch(() => { /* Show -- when open interest is unavailable */ })
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
