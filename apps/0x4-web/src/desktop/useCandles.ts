// 电脑端取 K 线：和手机币详情页（src/pages/Token.tsx）同一套——先画手上有的 / 快速线，完整历史到了整张换掉；换币换周期旧请求作废。
import { useEffect, useState } from 'react'
import { loadDexCandles, loadFastCandles, peekDexCandles, type DexCandles, type DexInterval } from '@/lib/candles'

export type CandleState = { status: 'idle' | 'loading' | 'ready' | 'error'; data: DexCandles | null }

export function useCandles(tk: { chain: string; address: string; pairAddress?: string } | null | undefined, interval: DexInterval, retry = 0): CandleState {
  const [s, set] = useState<CandleState>({ status: 'idle', data: null })
  const chain = tk?.chain, address = tk?.address, pairAddress = tk?.pairAddress
  useEffect(() => {
    if (!chain || !address || !pairAddress) { set({ status: 'idle', data: null }); return }
    const input = { chain, address, pairAddress, interval }
    const ctrl = new AbortController()
    const known = peekDexCandles(input)
    set((c) => known ? { status: 'ready', data: known } : { status: 'loading', data: c.data?.pairAddress === pairAddress && c.data.interval === interval ? c.data : null })
    let full = false
    loadDexCandles(input, ctrl.signal)
      .then((data) => { full = true; if (!ctrl.signal.aborted) set({ status: 'ready', data }) })
      // 完整历史失败时，手上已有这个交易对这个周期的快速线就留着显示，不报错
      .catch(() => { if (!ctrl.signal.aborted) set((c) => ({ status: c.data?.pairAddress === pairAddress && c.data.interval === interval ? 'ready' : 'error', data: c.data })) })
    if (!known) loadFastCandles(input).then((q) => { if (q && !full && !ctrl.signal.aborted) set({ status: 'ready', data: q }) })
    return () => ctrl.abort()
  }, [chain, address, pairAddress, interval, retry])
  return s
}
