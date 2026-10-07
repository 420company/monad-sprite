// Candle prefetch entry for coins (2026-09-29 goat: opening a coin's chart never appears instantly): called on finger-down in lists and on dwell in Discover.
// The pair address comes from the market cache (listed coins are all there); the timeframe uses the coin page's remembered one (default 1h); quota and dedupe are managed in candles.ts.
// Prefetch both paths: GeckoTerminal's full history, and the already-cached copy in the server channel (cache reads only — no DexPaprika quota spent).
import { prefetchDexCandles, prefetchServerCandles, type DexInterval } from './candles'
import { marketKey } from './market'
import { oneOf, readPageState } from './pageState'
import { useMarket } from '@/store/market'

export function prefetchTokenChart(token: { chain?: string; address?: string; pairAddress?: string } | null | undefined) {
  if (!token?.chain || !token.address) return
  const pairAddress = token.pairAddress || useMarket.getState().cache[marketKey(token.chain, token.address)]?.pairAddress
  if (!pairAddress) return
  const interval = readPageState<DexInterval>('token.interval', '1h', oneOf('15m', '1h', '4h', '1d'))
  const input = { chain: token.chain, address: token.address, pairAddress, interval }
  prefetchDexCandles(input)
  prefetchServerCandles(input)
}

/**
 * Press-to-prefetch for list rows: start pulling when the finger stays within 90ms of pressing down without much movement (not scrolling the list); pull immediately on lift if not yet pulled;
 * void it if the finger moves more than 8px after pressing (scrolling started) or the system cancels. Every row gets a press event while scrolling — pulling directly would waste prefetch quota.
 */
let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; fire: () => void } | null = null
const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null } }
export function pressPrefetchHandlers(token: Parameters<typeof prefetchTokenChart>[0]) {
  return {
    onPointerDown: (e: { clientX: number; clientY: number }) => {
      cancelPress()
      const fire = () => { cancelPress(); prefetchTokenChart(token) }
      press = { timer: setTimeout(fire, 90), x: e.clientX, y: e.clientY, fire }
    },
    onPointerMove: (e: { clientX: number; clientY: number }) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress()
    },
    onPointerUp: () => { press?.fire() },
    onPointerCancel: cancelPress,
  }
}
