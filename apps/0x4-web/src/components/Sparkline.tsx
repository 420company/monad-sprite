// 只接受带真实时间戳的 OHLCV；不再用涨跌幅反推曲线或填补缺失蜡烛。
import { useEffect, useMemo, useRef } from 'react'
import { CandlestickSeries, createChart, type UTCTimestamp } from 'lightweight-charts'
import { ChartNoAxesCombined } from 'lucide-react'
import type { Candle } from '@/lib/aster'
import { t } from '@/lib/i18n'

export default function Sparkline({ candles = [], height = 240, label = t('价格走势') }: { candles?: Candle[]; height?: number; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const data = useMemo(() => {
    const valid = candles.filter(k => [k.time, k.open, k.high, k.low, k.close, k.volume].every(Number.isFinite)
      && Number.isInteger(k.time) && k.time > 0 && k.low > 0 && k.volume >= 0
      && k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close))
    return [...new Map(valid.map(k => [k.time, k])).values()].sort((a, b) => a.time - b.time)
  }, [candles])

  useEffect(() => {
    if (!box.current || !data.length) return
    const css = getComputedStyle(document.documentElement)
    const up = css.getPropertyValue('--color-up').trim(), down = css.getPropertyValue('--color-down').trim()
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: css.getPropertyValue('--color-muted').trim(), attributionLogo: false },   // 不在图上放 TradingView 标志；许可要求的出处写在「我 → 高级 → 开源许可」（2026-09-27 goat）
      grid: { vertLines: { visible: false }, horzLines: { color: css.getPropertyValue('--color-line').trim() } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScale: { axisPressedMouseMove: false },
      handleScroll: { vertTouchDrag: false },
    })
    const smallest = Math.min(...data.map(k => k.low))
    const precision = Math.min(16, Math.max(2, 3 - Math.floor(Math.log10(smallest))))
    const series = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat: { type: 'price', precision, minMove: 10 ** -precision } })
    series.setData(data.map(k => ({ ...k, time: k.time as UTCTimestamp })))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [data])

  return data.length ? <div ref={box} style={{ height }} className="min-w-0 w-full" role="img" aria-label={t('{label}，{n} 根 K 线', { label, n: data.length })} /> : (
    <div style={{ minHeight: height }} className="flex flex-col items-center justify-center gap-3 border-y border-line text-muted" role="status">
      <ChartNoAxesCombined size={28} strokeWidth={1.5} aria-hidden="true" />
      <span className="text-sm">{t('暂无历史 K 线')}</span>
    </div>
  )
}
