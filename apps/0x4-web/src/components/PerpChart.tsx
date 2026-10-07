// Perp page K-line chart. Uses TradingView's lightweight-charts (45KB gzip); data from Aster's public candle API.
//
// Why not hand-rolled canvas: crosshair, zoom, adaptive scales, time-axis alignment —
// all would need rebuilding, and never feel the same. The chart is the trade page's core, not decoration.
//
// 2026-09-24 rework: MA7 / MA25 lines, press-and-hold OHLC, price precision follows the coin
// (previously fixed 2 decimals — a 0.004354 coin rendered every axis label as 0.00).
import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { loadCandles, type Candle, type Interval } from '@/lib/aster'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

const INTERVALS: { key: Interval; label: string }[] = [
  { key: '15m', label: '15分' },
  { key: '1h', label: '1时' },
  { key: '4h', label: '4时' },
  { key: '1d', label: '日' },
]

const MA7 = '#e9ba72'
const MA25 = '#7aa2ff'

/** Price precision: prefer the exchange's; estimate by price magnitude when unavailable, guaranteeing ≥4 significant digits for small coins */
function precisionOf(pxDecimals: number | undefined, sample: number) {
  if (pxDecimals !== undefined) return Math.max(1, Math.min(10, pxDecimals))
  if (!(sample > 0)) return 2
  return Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(sample))))
}

function movingAverage(data: Candle[], n: number) {
  const out: { time: UTCTimestamp; value: number }[] = []
  let sum = 0
  data.forEach((k, i) => {
    sum += k.close
    if (i >= n) sum -= data[i - n].close
    if (i >= n - 1) out.push({ time: k.time as UTCTimestamp, value: sum / n })
  })
  return out
}

// Market data is public: always show real candles, locked wallet or not.
export default function PerpChart({ coin, pxDecimals }: { coin: string; pxDecimals?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ma7 = useRef<ISeriesApi<'Line'> | null>(null)
  const ma25 = useRef<ISeriesApi<'Line'> | null>(null)
  const last = useRef<Candle | null>(null)
  const digits = useRef(2)
  const [interval, setInterval] = useState<Interval>('1h')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Top OHLC row: shows the pressed candle while touching, the latest on release */
  const [ohlc, setOhlc] = useState<Candle | null>(null)

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: digits.current, maximumFractionDigits: digits.current })

  // Build the chart once; coin/interval switches only swap data
  useEffect(() => {
    if (!box.current) return
    const css = getComputedStyle(document.documentElement)
    const c = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const muted = c('--color-muted', '#a7adb2')
    const chartApi = createChart(box.current, {
      layout: { background: { color: 'transparent' }, textColor: '#6f767c', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,.04)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: {
        mode: 1,
        vertLine: { color: muted, labelBackgroundColor: c('--color-card2', '#232629') },
        horzLine: { color: muted, labelBackgroundColor: c('--color-card2', '#232629') },
      },
      handleScale: { axisPressedMouseMove: false },
      handleScroll: { vertTouchDrag: false },
      autoSize: true,
    })
    chart.current = chartApi
    const up = c('--color-up', '#43d6a0'), down = c('--color-down', '#ff727c')
    candles.current = chartApi.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
    })
    // Volume gets no last-value label or line: drawn on the price axis it would read as a second price
    volume.current = chartApi.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false })
    // Volume squeezed into the bottom fifth, out of the candles' way
    chartApi.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    const line = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
    ma7.current = chartApi.addSeries(LineSeries, { ...line, color: MA7 })
    ma25.current = chartApi.addSeries(LineSeries, { ...line, color: MA25 })

    chartApi.subscribeCrosshairMove((e) => {
      const k = candles.current ? e.seriesData.get(candles.current) as Candle | undefined : undefined
      setOhlc(k && 'open' in k ? k : last.current)
    })
    return () => { chartApi.remove(); chart.current = null; candles.current = null; volume.current = null; ma7.current = null; ma25.current = null }
  }, [])

  // Fetch: refetch on coin/interval switch, and refresh the last candle on the interval timer
  useEffect(() => {
    let dead = false
    const pull = async (first: boolean) => {
      if (first) { setLoading(true); setErr(null) }
      try {
        const data = await loadCandles(coin, interval)
        if (dead || !candles.current || !volume.current || !data.length) return
        digits.current = precisionOf(pxDecimals, data[data.length - 1].close)
        candles.current.applyOptions({ priceFormat: { type: 'price', precision: digits.current, minMove: 10 ** -digits.current } })
        candles.current.setData(data.map((k) => ({ ...k, time: k.time as UTCTimestamp })))
        const up = getComputedStyle(document.documentElement).getPropertyValue('--color-up').trim() || '#43d6a0'
        const down = getComputedStyle(document.documentElement).getPropertyValue('--color-down').trim() || '#ff727c'
        volume.current.setData(data.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: (k.close >= k.open ? up : down) + '40' })))
        ma7.current?.setData(movingAverage(data, 7))
        ma25.current?.setData(movingAverage(data, 25))
        last.current = data[data.length - 1]
        setOhlc((cur) => (first || !cur || cur.time === last.current?.time ? last.current : cur))
        // Default to the latest 60 candles so they don't squeeze into a line; drag sideways for older ones
        if (first) chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 60), to: data.length + 3 })
        setErr(null)
      } catch (e) {
        if (!dead && first) setErr(errorText(e, t('行情加载失败')))
      } finally {
        if (!dead && first) setLoading(false)
      }
    }
    pull(true)
    // 15m charts refresh more often; dailies don't need it
    const every = interval === '15m' ? 20_000 : interval === '1h' ? 60_000 : 300_000
    const timer = window.setInterval(() => pull(false), every)
    return () => { dead = true; window.clearInterval(timer) }
  }, [coin, interval, pxDecimals])

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1 px-4" role="group" aria-label={t('K 线周期')}>
        {INTERVALS.map((iv) => (
          <button key={iv.key} onClick={() => setInterval(iv.key)} aria-pressed={interval === iv.key}
            className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors ${interval === iv.key ? 'bg-card2 text-fg' : 'text-muted'}`}>
            {t(iv.label)}
          </button>
        ))}
        <div className="ml-auto flex gap-2 text-[10px] font-medium">
          <span style={{ color: MA7 }}>MA7</span><span style={{ color: MA25 }}>MA25</span>
        </div>
      </div>
      <div className="flex h-5 items-center gap-2.5 px-4 text-[10px] text-muted tabular-nums">
        {ohlc && <>
          <span>{t('开||ohlc')} <b className="font-semibold text-fg">{fmt(ohlc.open)}</b></span>
          <span>{t('高')} <b className="font-semibold text-fg">{fmt(ohlc.high)}</b></span>
          <span>{t('低')} <b className="font-semibold text-fg">{fmt(ohlc.low)}</b></span>
          <span>{t('收')} <b className={`font-semibold ${ohlc.close >= ohlc.open ? 'text-up' : 'text-down'}`}>{fmt(ohlc.close)}</b></span>
        </>}
      </div>
      <div className="relative px-1">
        <div ref={box} className="h-[250px] w-full" />
        {(loading || err) && (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted" role="status">{err ? t('行情暂不可用') : t('加载 K 线…')}</div>
        )}
      </div>
    </div>
  )
}
