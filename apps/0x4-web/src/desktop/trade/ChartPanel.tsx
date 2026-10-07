// 交易终端的 K 线面板（现货、合约共用）：上面一条工具栏（周期 + 状态），下面图表铺满。
// ★状态只显示一个（2026-09-29 goat：BTCB 那里「K 线加载失败，重试」和「暂无历史 K 线」同时出现）：
//   有数据 → 画图（刷新失败时工具栏小字说明显示的是上次的数据，可重试）；
//   没数据 → 加载中 / 加载失败（带重试）/ 这个交易对没有 K 线 / 暂无历史 K 线，四选一，只在图表区域中间说一次。
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
  /** ready 但 candles 为空 = 这个周期暂时没有成交 */
  status: ChartStatus
  asOf?: number
  onRetry: () => void
  formatPrice?: (n: number) => string
  /** 合约页：画在图上的交易计划线 */
  plan?: PlanProps
  /** 合约页：买卖力量一栏、大单气泡（见 ProChart） */
  flow?: FlowPoint[] | null
  bubbles?: Bubble[]
  bubbleMin?: number
  /** 工具栏右侧额外内容 */
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
