// 合约交易页的 K 线。用 TradingView 的 lightweight-charts（45KB gzip），数据来自 Aster 公开 K 线接口。
//
// 为什么不自己用 canvas 画：十字线、缩放、自适应刻度、时间轴对齐这些
// 全都要重做一遍，而且做不到同样的手感。图表是交易页的主体，不是装饰。
//
// 2026-09-24 重做：加 MA7 / MA25 均线、按住显示开高低收、价格精度跟币种走
// （以前默认两位小数，0.004354 的币整张图刻度都是 0.00）。
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

/** 价格精度：优先用交易所给的，拿不到就按价格量级估，保证小币至少有 4 位有效数字 */
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

// 行情是公开数据，永远显示真实 K 线，钱包锁没锁都一样。
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
  /** 顶部那一行开高低收：手指按住时显示按住的那根，松开显示最新一根 */
  const [ohlc, setOhlc] = useState<Candle | null>(null)

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: digits.current, maximumFractionDigits: digits.current })

  // 建图表：只建一次，切币种和周期只换数据
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
    // 成交量不要最新值标签和横线：它画在价格轴上会被当成第二个价格
    volume.current = chartApi.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false })
    // 成交量压在底部五分之一，不抢蜡烛的地方
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

  // 取数据：切币种或周期时重新拉，并按周期定时刷新最后一根
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
        // 默认只看最近 60 根，蜡烛才不会挤成一条线；可以左右拖看更早的
        if (first) chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 60), to: data.length + 3 })
        setErr(null)
      } catch (e) {
        if (!dead && first) setErr(errorText(e, t('行情加载失败')))
      } finally {
        if (!dead && first) setLoading(false)
      }
    }
    pull(true)
    // 15 分钟的图刷得勤一点，日线没必要
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
