// Desktop candle fetching: same as the mobile token detail page (src/pages/Token.tsx) — draw what's on hand / the fast line first, replace wholesale when full history arrives; switching tokens or intervals voids old requests.
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
      // When full history fails, keep showing the fast line already on hand for this pair+interval — no error
      .catch(() => { if (!ctrl.signal.aborted) set((c) => ({ status: c.data?.pairAddress === pairAddress && c.data.interval === interval ? 'ready' : 'error', data: c.data })) })
    if (!known) loadFastCandles(input).then((q) => { if (q && !full && !ctrl.signal.aborted) set({ status: 'ready', data: q }) })
    return () => ctrl.abort()
  }, [chain, address, pairAddress, interval, retry])
  return s
}
