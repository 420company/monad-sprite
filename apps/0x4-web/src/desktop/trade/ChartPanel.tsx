// The trading terminal's chart panel (shared by spot and perps): a toolbar on top (period + status), the chart filling below.
// ★ Only one status is shown (2026-09-29 goat: on BTCB "chart failed to load, retry" and "no historical candles" appeared at once):
//   data → draw the chart (on refresh failure the toolbar's small print says it's showing last time's data, with a retry);
//   no data → pick one of loading / load failed (with retry) / this pair has no candles / no historical candles — stated once, centered in the chart area.
import type { ReactNode } from 'react'
import { CandlestickChart, RefreshCw } from 'lucide-react'
import type { Candle } from '@/lib/aster'
import { locale, t } from '@/lib/i18n'
import ProChart from '../ProChart'
import type { PlanProps } from './PlanOverlay'
import type { Bubble, FlowPoint } from '@/lib/perpFlow'

export type ChartStatus = 'loading' | 'ready' | 'error' | 'unsupported'

export default function ChartPanel<I extends string>({ intervals, interval, onInterval, candles, chartKey, status, asOf, onRetry, formatPrice, plan, flow, bubbles, bubbleMin, children }: {
  intervals: readonly I[]; interval: I; onInterval: (i: I) => void
  candles: Candle[]; chartKey: string
  /** ready but candles empty = no trades yet in this period */
  status: ChartStatus
  asOf?: number
  onRetry: () => void
  formatPrice?: (n: number) => string
  /** Perp page: trade-plan lines drawn on the chart */
  plan?: PlanProps
  /** Perp page: the buy/sell pressure column and large-order bubbles (see ProChart) */
  flow?: FlowPoint[] | null
  bubbles?: Bubble[]
  bubbleMin?: number
  /** Extra content on the toolbar's right */
  children?: ReactNode
}) {
  const has = candles.length > 0
  return (
    <section className="tx-panel tx-chart" aria-label={t('历史行情')}>
      <div className="tx-chart-bar">
        <div className="tx-ivals" role="group" aria-label={t('K 线周期')}>
          {intervals.map((k) => <button key={k} type="button" onClick={() => onInterval(k)} aria-pressed={interval === k} className={interval === k ? 'on' : ''}>{k}</button>)}
        </div>
        {children}
        <span className="tx-chart-status" role="status">
          {has && status === 'error'
            ? <button type="button" className="tx-link warn" onClick={onRetry}>{t('刷新失败，显示的是上次的数据')}<RefreshCw size={12} /></button>
            : has && asOf ? t('更新于 {time}', { time: new Date(asOf).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : null}
        </span>
      </div>
      <div className="tx-chart-box">
        {has ? <ProChart candles={candles} interval={chartKey} legend formatPrice={formatPrice} plan={plan} flow={flow} bubbles={bubbles} bubbleMin={bubbleMin} />
          : status === 'loading' ? <div className="tx-chart-state"><span className="tx-spin" aria-hidden="true" /><span>{t('正在加载 K 线')}</span></div>
            : status === 'error' ? <div className="tx-chart-state"><CandlestickChart size={20} aria-hidden="true" /><span>{t('K 线加载失败')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button></div>
              : status === 'unsupported' ? <div className="tx-chart-state"><CandlestickChart size={20} aria-hidden="true" /><span>{t('该交易对暂无 K 线')}</span></div>
                : <div className="tx-chart-state"><CandlestickChart size={20} aria-hidden="true" /><span>{t('暂无历史 K 线')}</span></div>}
      </div>
    </section>
  )
}
