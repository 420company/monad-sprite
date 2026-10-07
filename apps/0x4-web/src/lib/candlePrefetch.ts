// 币种 K 线预取入口（2026-09-29 goat：点开币种 K 线总是不能秒出）：列表上手指按下、发现页停留时调用。
// 交易对地址从行情缓存里找（列表里的币都在），周期用币种页记住的那个（默认 1 小时），额度和去重在 candles.ts 里管。
// 两路一起预取：GeckoTerminal 完整历史，和服务器通道里已经缓存的那份（只读缓存，不花 DexPaprika 额度）。
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
 * 列表行用的按下预取：手指按下 90 毫秒内没怎么移动（不是在滑列表）就开始拉，抬起时还没拉就立刻拉；
 * 按下后移动超过 8 像素（开始滑动）或系统取消就作废。滑列表时每行都会先收到按下事件，直接拉会白白用掉预取额度。
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
