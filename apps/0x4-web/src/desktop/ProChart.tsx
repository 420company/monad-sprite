// Desktop K-lines (2026-09-29 goat: the web should look like a pro trading terminal): candles + bottom volume, filling the parent container.
// Ported from the old web build web/src/components/Chart.tsx; colors follow the theme (--color-up / --color-down). On data change only the series update — the chart is never rebuilt.
// Top-left OHLC (modeled on Hyperliquid / Backpack): hovering a candle shows that candle; moving away shows the latest.
// Only draw real OHLCV: with no data, the caller shows the empty state — no fake lines here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, type AutoscaleInfo, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '@/lib/aster'
import { fmtUsd } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import PlanOverlay, { type PlanProps } from './trade/PlanOverlay'
import { scalePrices, stretchRange } from './trade/planLines'
import { bubbleSize, usdShort, type Bubble, type FlowPoint } from '@/lib/perpFlow'

const cssVar = (name: string, fallback: string) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback)
/** #rrggbb → rgba(); returned as-is when the theme color isn't six-digit hex */
const alpha = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const defaultPrice = (p: number) => fmtUsd(p).replace('$', '')
/**
 * The chart library always draws its x-axis in UTC. Shifting timestamps by the local offset before handing them over puts the axis and crosshair times on the user's own clock
 * (2026-10-02: after adding the 1-minute line, 05:45 on the chart vs 12:45 on the computer was jarring).
 * One offset for the whole chart (computed at the latest candle's moment): if each candle used its own, the DST fall-back hour would produce two candles with identical times and the chart library errors out.
 */
export const tzOffsetSec = (lastTime: number) => -new Date(lastTime * 1000).getTimezoneOffset() * 60
/** Convert theme colors into the rgba() syntax the chart library understands (theme variables contain the new syntax like rgb(52 36 102 / .03), which the chart library doesn't) */
const resolveColor = (v: string, fallback: string) => {
  if (typeof document === 'undefined') return fallback
  try { const d = document.createElement('i'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c || fallback } catch { return fallback }
}
/** The chart colors that follow midnight-black / taro-white (2026-10-02): axis text, grid, crosshair, and its label background */
const themeOptions = () => {
  const cross = resolveColor('var(--w-tint-4, rgba(255,255,255,0.22))', 'rgba(255,255,255,0.22)')
  const label = resolveColor('var(--w-raised, #262b38)', '#262b38')
  const grid = resolveColor('var(--w-tint-1, rgba(255,255,255,0.03))', 'rgba(255,255,255,0.03)')
  return {
    layout: { textColor: cssVar('--color-muted', '#8b86a3') },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    crosshair: { vertLine: { color: cross, labelBackgroundColor: label }, horzLine: { color: cross, labelBackgroundColor: label } },
  }
}

/** Keep only valid candles (time is whole seconds, high/low contain open/close), deduped and sorted by time */
export function cleanCandles(candles: Candle[]): Candle[] {
  const valid = candles.filter((k) => [k.time, k.open, k.high, k.low, k.close].every(Number.isFinite) && Number.isInteger(k.time) && k.time > 0 && k.low > 0
    && k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close))
  return [...new Map(valid.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time)
}

export default function ProChart({ candles, interval, volume = true, compact = false, legend = false, formatPrice = defaultPrice, plan, flow, bubbles, bubbleMin = 0 }: {
  candles: Candle[]; interval: string
  /** Bottom volume bars */
  volume?: boolean
  /** Thumbnail: no axes, no drag/zoom, fills the whole span */
  compact?: boolean
  /** Top-left shows OHLC */
  legend?: boolean
  /** Price format (perps follow exchange precision) */
  formatPrice?: (n: number) => string
  /** Perps page trade-plan lines (entry price, liquidation price, TP/SL, order preview), overlaid on the chart */
  plan?: PlanProps
  /** Buy/sell pressure (perp page): when provided, adds a pane below the candles — bars = net aggressive buys per candle, line = cumulative */
  flow?: FlowPoint[] | null
  /** Large-order bubbles (perps page): at most one per K-line per side, drawn at the average fill price — bigger amount, bigger bubble */
  bubbles?: Bubble[]
  /** Large-order threshold (USD): bubble sizes are computed from it */
  bubbleMin?: number
}) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null)
  const flowBar = useRef<ISeriesApi<'Histogram'> | null>(null)
  const flowLine = useRef<ISeriesApi<'Line'> | null>(null)
  const marks = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const hasFlow = !!flow && flow.length > 0
  /** Which pixel the buy/sell pressure strip's top sits at (a line of small print goes above it) */
  const [flowTop, setFlowTop] = useState<number | null>(null)
  const colors = useRef({ up: '#43d6a0', down: '#ff8f97' })
  const lastSig = useRef('')
  const lastFirst = useRef(0)
  const fmt = useRef(formatPrice)
  fmt.current = formatPrice
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => cleanCandles(candles), [candles])
  const off = useMemo(() => data.length ? tzOffsetSec(data[data.length - 1].time) : 0, [data])
  const local = (t: number) => t + off

  useEffect(() => {
    if (!el.current) return
    const up = cssVar('--color-up', '#43d6a0'), down = cssVar('--color-down', '#ff8f97')
    colors.current = { up, down }
    const th = themeOptions()
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: th.layout.textColor, fontFamily: '"Geist Variable", Geist, system-ui, sans-serif', fontSize: 11, attributionLogo: false, panes: { enableResize: false, separatorColor: th.grid.horzLines.color } },
      grid: th.grid,
      rightPriceScale: { borderVisible: false, scaleMargins: { top: legend ? 0.12 : 0.08, bottom: volume ? 0.24 : 0.06 }, visible: !compact },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, visible: !compact },
      crosshair: { mode: CrosshairMode.Normal, ...th.crosshair },
      handleScale: !compact, handleScroll: !compact,
      // X-axis dates follow the app language (not the browser language — no CJK date suffixes in the English UI)
      // With the "buy/sell pressure" pane present, don't set a chart-wide price format (that pane shows dollar amounts) — each pane uses its own series' format
      localization: hasFlow ? { locale: locale() } : { priceFormatter: (p: number) => fmt.current(p), locale: locale() },
    })
    series.current = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat: { type: 'custom', minMove: 1e-12, formatter: (p: number) => fmt.current(p) } })
    if (volume) {
      vol.current = c.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
      vol.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    }
    // Buy/sell pressure: its own strip under the K-lines (one fifth of the height). Bars = per-candle net aggressive buying, line = cumulative (each on its own scale; the line's scale is hidden)
    if (hasFlow) {
      flowBar.current = c.addSeries(HistogramSeries, { priceFormat: { type: 'custom', minMove: 1, formatter: (v: number) => `${v < 0 ? '-' : ''}${usdShort(v).replace(/\.0+(?=[KMB]?$)/, '')}` }, lastValueVisible: false, priceLineVisible: false }, 1)
      flowLine.current = c.addSeries(LineSeries, { priceScaleId: 'left', lineWidth: 2, color: cssVar('--w-accent', '#b9a6ff'), lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, 1)
      c.priceScale('left', 1).applyOptions({ visible: false, scaleMargins: { top: 0.34, bottom: 0.1 } })
      c.priceScale('right', 1).applyOptions({ borderVisible: false, scaleMargins: { top: 0.34, bottom: 0.06 } })
      const panes = c.panes()
      panes[0]?.setStretchFactor(4)
      panes[1]?.setStretchFactor(1)
    }
    marks.current = createSeriesMarkers(series.current, [])
    if (legend) c.subscribeCrosshairMove((p) => setHover(typeof p.time === 'number' ? p.time : null))
    chart.current = c
    // Where the buy/sell pressure strip is: the chart resizes with its container — measure how tall the strip above is
    let raf = 0
    const measure = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const h = hasFlow ? c.panes()[0]?.getHeight() : undefined; setFlowTop(h && h > 0 ? h : null) }) }
    const ro = new ResizeObserver(measure)
    ro.observe(el.current)
    measure()
    return () => { ro.disconnect(); cancelAnimationFrame(raf); c.remove(); chart.current = null; series.current = null; vol.current = null; flowBar.current = null; flowLine.current = null; marks.current = null; lastSig.current = ''; lastFirst.current = 0 }
  }, [volume, compact, legend, hasFlow])

  // Trading lines: ones not too far from the K-lines (entry price, TP/SL, preview lines) are included when the chart auto-scales — otherwise they're often outside the visible range and can't be dragged.
  // Don't move while a line is being dragged (the chart scales along and the line would slip from under the finger); recompute after release.
  const [planDrag, setPlanDrag] = useState(false)
  const planPrices = useRef<number[]>([])
  const scaleSig = plan ? scalePrices(plan.lines).join(',') : ''
  useEffect(() => {
    const s = series.current
    if (!s || !plan || planDrag) return
    planPrices.current = scaleSig ? scaleSig.split(',').map(Number) : []
    // Swap in a fresh function each time: the chart library recomputes the price range from it
    s.applyOptions({
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const r = base()
        if (!r?.priceRange || !planPrices.current.length) return r
        const { min, max } = stretchRange(r.priceRange.minValue, r.priceRange.maxValue, planPrices.current)
        return { ...r, priceRange: { minValue: min, maxValue: max } }
      },
    })
  }, [scaleSig, planDrag, !!plan, volume, compact, legend, hasFlow]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switching midnight-black / taro-white: the chart recolors in place, no page reload needed
  const theme = useTheme((s) => s.theme)
  useEffect(() => {
    const c = chart.current
    if (!c || !series.current) return
    const up = cssVar('--color-up', '#43d6a0'), down = cssVar('--color-down', '#ff8f97')
    colors.current = { up, down }
    const th = themeOptions()
    c.applyOptions({ ...th, layout: { ...th.layout, panes: { separatorColor: th.grid.horzLines.color } } })
    series.current.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down })
    flowLine.current?.applyOptions({ color: cssVar('--w-accent', '#b9a6ff') })
  }, [theme])

  // Buy/sell pressure data
  useEffect(() => {
    if (!flowBar.current || !flowLine.current || !flow) return
    const { up, down } = colors.current
    flowBar.current.setData(flow.map((f) => ({ time: local(f.time) as UTCTimestamp, value: f.delta, color: alpha(f.delta >= 0 ? up : down, 0.6) })))
    flowLine.current.setData(flow.map((f) => ({ time: local(f.time) as UTCTimestamp, value: f.cum })))
  }, [flow, off, hasFlow, theme, volume, compact, legend]) // eslint-disable-line react-hooks/exhaustive-deps

  // Large-order bubbles: drawn at this candle's large orders' average fill price — green for buys, red for sells, translucent; bigger amount, bigger bubble
  useEffect(() => {
    if (!marks.current) return
    const { up, down } = colors.current
    const first = data.length ? data[0].time : Infinity
    const list: SeriesMarker<Time>[] = (bubbles ?? []).filter((b) => b.time >= first).map((b) => ({
      time: local(b.time) as UTCTimestamp, position: 'atPriceMiddle' as const, price: b.px, shape: 'circle' as const,
      color: alpha(b.isBuy ? up : down, 0.5), size: bubbleSize(b.usd, bubbleMin),
    }))
    marks.current.setMarkers(list)
  }, [bubbles, bubbleMin, data, theme, hasFlow, volume, compact, legend]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = chart.current
    if (!c || !series.current) return
    const { up, down } = colors.current
    series.current.setData(data.map((k) => ({ time: local(k.time) as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })))
    vol.current?.setData(data.map((k) => ({ time: local(k.time) as UTCTimestamp, value: Number.isFinite(k.volume) ? k.volume : 0, color: alpha(k.close >= k.open ? up : down, 0.28) })))
    // When switching interval / coin, or when earlier history backfills (fast line replaced by full history), snap the view back to the latest 120 candles;
    // Background refresh of the same period (window slides one candle back) doesn't move where the user is looking
    const first = data.length ? data[0].time : 0
    if (data.length && (lastSig.current !== interval || first < lastFirst.current)) {
      lastSig.current = interval
      lastFirst.current = first
      const n = data.length
      if (compact) c.timeScale().fitContent()
      else c.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 3 })
    }
  }, [data, interval, compact, theme, hasFlow]) // eslint-disable-line react-hooks/exhaustive-deps

  const k = legend ? (hover !== null ? data.find((x) => local(x.time) === hover) : undefined) ?? data[data.length - 1] : undefined
  const chg = k && k.open > 0 ? (k.close - k.open) / k.open * 100 : null
  // Buy/sell pressure and large orders report whichever candle the mouse is on; the latest candle when it moves away
  const f = hasFlow && flow ? (k ? flow.find((x) => x.time === k.time) : undefined) ?? flow[flow.length - 1] : undefined
  const kb = k && bubbles ? bubbles.filter((b) => b.time === k.time) : []
  return (
    <div className="tx-chart-canvas">
      <div ref={el} className="tx-chart-canvas" />
      {k && <div className="tx-ohlc" aria-hidden="true">
        <span>{t('开||ohlc')}<b>{formatPrice(k.open)}</b></span>
        <span>{t('高||ohlc')}<b>{formatPrice(k.high)}</b></span>
        <span>{t('低||ohlc')}<b>{formatPrice(k.low)}</b></span>
        <span>{t('收||ohlc')}<b>{formatPrice(k.close)}</b></span>
        {chg !== null && <b className={chg >= 0 ? 'up' : 'down'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</b>}
        {kb.map((b) => <span key={String(b.isBuy)} className="tx-ohlc-big">{b.isBuy ? t('大单买入') : t('大单卖出')}<b className={b.isBuy ? 'up' : 'down'}>{usdShort(b.usd)}</b>{b.n > 1 && <small>{t('{n} 笔', { n: b.n })}</small>}</span>)}
      </div>}
      {f && flowTop !== null && <div className="tx-ohlc tx-flow-legend" style={{ top: flowTop + 6 }} aria-hidden="true">
        <span className="tx-flow-name">{t('买卖力量')}</span>
        <span>{f.delta >= 0 ? t('净买入') : t('净卖出')}<b className={f.delta >= 0 ? 'up' : 'down'}>{usdShort(f.delta)}</b></span>
        <span>{t('累计||flow')}<b className={f.cum >= 0 ? 'up' : 'down'}>{f.cum < 0 ? '-' : '+'}{usdShort(f.cum)}</b></span>
      </div>}
      {plan && <PlanOverlay chart={chart} series={series} formatPrice={formatPrice} onDragging={setPlanDrag} {...plan} />}
    </div>
  )
}
