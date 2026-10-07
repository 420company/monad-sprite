// 电脑端 K 线（2026-09-29 goat：网页版要像专业交易站）：蜡烛 + 底部成交量，铺满父容器。
// 移植自旧网页版 web/src/components/Chart.tsx；颜色跟主题（--color-up / --color-down）。数据换了只更新序列，不重建图表。
// 左上角开高低收（参考 Hyperliquid / Backpack）：鼠标停在哪根显示哪根，移开显示最新一根。
// 只画真实 OHLCV：没有数据时由调用方显示空状态，这里不补假线。
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
/** #rrggbb → rgba()；主题色写法不是六位十六进制时原样返回 */
const alpha = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const defaultPrice = (p: number) => fmtUsd(p).replace('$', '')
/**
 * 图表库的横轴一律按 UTC 画。把时间戳挪一个本地时差再交给它，横轴和十字线上的时间就是用户电脑上的钟点
 * （2026-10-02：加了 1 分钟线以后，图上 05:45、电脑上 12:45 特别扎眼）。
 * 整张图用同一个时差（按最新一根 K 线那一刻算）：要是每根各算各的，夏令时往回拨的那一小时会出现两根时间相同的 K 线，图表库直接报错。
 */
export const tzOffsetSec = (lastTime: number) => -new Date(lastTime * 1000).getTimezoneOffset() * 60
/** 主题里的颜色转成图表库认得的 rgba() 写法（主题变量里有 rgb(52 36 102 / .03) 这种新写法，图表库不认） */
const resolveColor = (v: string, fallback: string) => {
  if (typeof document === 'undefined') return fallback
  try { const d = document.createElement('i'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c || fallback } catch { return fallback }
}
/** 跟着午夜黑 / 香芋白走的那部分图表颜色（2026-10-02）：坐标文字、网格、十字线和它的标签底色 */
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

/** 只留合法的蜡烛（时间是整数秒、高低价包住开收），按时间去重排序 */
export function cleanCandles(candles: Candle[]): Candle[] {
  const valid = candles.filter((k) => [k.time, k.open, k.high, k.low, k.close].every(Number.isFinite) && Number.isInteger(k.time) && k.time > 0 && k.low > 0
    && k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close))
  return [...new Map(valid.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time)
}

export default function ProChart({ candles, interval, volume = true, compact = false, legend = false, formatPrice = defaultPrice, plan, flow, bubbles, bubbleMin = 0 }: {
  candles: Candle[]; interval: string
  /** 底部成交量柱 */
  volume?: boolean
  /** 小图：不显示坐标轴、不能拖动缩放，整段铺满 */
  compact?: boolean
  /** 左上角显示开高低收 */
  legend?: boolean
  /** 价格格式（合约按交易所精度） */
  formatPrice?: (n: number) => string
  /** 合约页的交易计划线（开仓价、强平价、止盈止损、下单预览），盖在图上面 */
  plan?: PlanProps
  /** 买卖力量（合约页）：给了就在 K 线下面多一栏，柱 = 每根的净主动买入，线 = 累计 */
  flow?: FlowPoint[] | null
  /** 大单气泡（合约页）：每根 K 线每个方向最多一个，画在成交均价上，越大越大 */
  bubbles?: Bubble[]
  /** 大单门槛（美元）：气泡大小按它算 */
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
  /** 买卖力量那一栏的顶在第几个像素（上面写一行小字） */
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
      // 横轴日期跟应用语言走（不跟浏览器语言，英文界面不出现「25日」）
      // 有「买卖力量」一栏时不设全图统一的价格格式（那一栏是美元金额），各栏用各自序列上的格式
      localization: hasFlow ? { locale: locale() } : { priceFormatter: (p: number) => fmt.current(p), locale: locale() },
    })
    series.current = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat: { type: 'custom', minMove: 1e-12, formatter: (p: number) => fmt.current(p) } })
    if (volume) {
      vol.current = c.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
      vol.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    }
    // 买卖力量：K 线下面单独一栏（占五分之一）。柱 = 每根的净主动买入，线 = 累计（各用各的刻度，线的刻度不显示）
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
    // 买卖力量那一栏在哪：图表自己跟着容器变大小，量一下上面那栏有多高
    let raf = 0
    const measure = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const h = hasFlow ? c.panes()[0]?.getHeight() : undefined; setFlowTop(h && h > 0 ? h : null) }) }
    const ro = new ResizeObserver(measure)
    ro.observe(el.current)
    measure()
    return () => { ro.disconnect(); cancelAnimationFrame(raf); c.remove(); chart.current = null; series.current = null; vol.current = null; flowBar.current = null; flowLine.current = null; marks.current = null; lastSig.current = ''; lastFirst.current = 0 }
  }, [volume, compact, legend, hasFlow])

  // 交易线：离 K 线不太远的（开仓价、止盈止损、预览线）让图表自动缩放时一起照顾到，不然它们常常在可见范围外面、拖不了。
  // 正在拖线的时候不动（图表跟着缩放，线会从手底下跑掉），松手后再算。
  const [planDrag, setPlanDrag] = useState(false)
  const planPrices = useRef<number[]>([])
  const scaleSig = plan ? scalePrices(plan.lines).join(',') : ''
  useEffect(() => {
    const s = series.current
    if (!s || !plan || planDrag) return
    planPrices.current = scaleSig ? scaleSig.split(',').map(Number) : []
    // 每次换一个新函数：图表库据此重新算一遍价格范围
    s.applyOptions({
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const r = base()
        if (!r?.priceRange || !planPrices.current.length) return r
        const { min, max } = stretchRange(r.priceRange.minValue, r.priceRange.maxValue, planPrices.current)
        return { ...r, priceRange: { minValue: min, maxValue: max } }
      },
    })
  }, [scaleSig, planDrag, !!plan, volume, compact, legend, hasFlow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换午夜黑 / 香芋白：图表原地换颜色，不用重开页面
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

  // 买卖力量的数据
  useEffect(() => {
    if (!flowBar.current || !flowLine.current || !flow) return
    const { up, down } = colors.current
    flowBar.current.setData(flow.map((f) => ({ time: local(f.time) as UTCTimestamp, value: f.delta, color: alpha(f.delta >= 0 ? up : down, 0.6) })))
    flowLine.current.setData(flow.map((f) => ({ time: local(f.time) as UTCTimestamp, value: f.cum })))
  }, [flow, off, hasFlow, theme, volume, compact, legend]) // eslint-disable-line react-hooks/exhaustive-deps

  // 大单气泡：画在这根 K 线里大单的成交均价上，买绿卖红、半透明，金额越大泡越大
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
    // 换周期 / 换币、或补到了更早的历史（快速线换成完整历史）时，把视野拉回最近 120 根；
    // 同一周期后台刷新（窗口往后滑一根）不动用户正在看的位置
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
  // 鼠标停在哪根，买卖力量和大单就说哪根；移开说最新一根
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
