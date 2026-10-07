// 合约终端右侧「盘口 / 最新成交」（参考 Hyperliquid、Lighter）：交易所公开接口的真实深度和逐笔，数据来自 usePerpLive。
// · 盘口：卖盘在上（最低价贴中线）、买盘在下，每侧显示能放下的档数（按面板高度算，最多 20 档）；
//   深色条按累计数量画；中线是最新成交价（按最后一笔方向着色）+ 标记价 + 价差。点某一档把价格填进限价单
// · 最新成交：价格（主动买绿 / 主动卖红）、数量、时间；大单（金额过了 usePerpLive 算的门槛）整行加底色
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { usePageState, oneOf } from '@/lib/pageState'
import type { OrderBook as Book, TapeTrade } from '@/lib/asterBook'
import type { LiveMode } from './usePerpLive'

const ROW = 20
const MID = 32

export default function OrderBook({ coin, book, tape, mark, mode, bigMin = 0, pxText, szDecimals, onPickPrice, onRetry }: {
  coin: string; book: Book | null; tape: TapeTrade[]; mark?: number; mode: LiveMode
  /** 大单门槛（美元，0 = 还不知道）：最新成交里过了门槛的那几笔标出来 */
  bigMin?: number
  pxText: (n: number) => string; szDecimals: number
  onPickPrice: (px: number) => void; onRetry: () => void
}) {
  const [tab, setTab] = usePageState<'book' | 'trades'>('desk.perp.book', 'book', oneOf('book', 'trades'))
  const body = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState(10)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setRows(Math.max(3, Math.min(20, Math.floor((el.clientHeight - MID) / 2 / ROW)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [tab])

  const asks = useMemo(() => (book?.asks ?? []).slice(0, rows), [book, rows])
  const bids = useMemo(() => (book?.bids ?? []).slice(0, rows), [book, rows])
  // 累计数量：卖盘从中线往上累加，买盘从中线往下累加；深度条按两边最大的累计量归一
  const askCum = useMemo(() => { let c = 0; return asks.map((l) => (c += l.sz)) }, [asks])
  const bidCum = useMemo(() => { let c = 0; return bids.map((l) => (c += l.sz)) }, [bids])
  const maxCum = Math.max(askCum[askCum.length - 1] || 0, bidCum[bidCum.length - 1] || 0) || 1
  const bestAsk = asks[0]?.px, bestBid = bids[0]?.px
  const spread = bestAsk && bestBid ? bestAsk - bestBid : undefined
  const last = tape[0]
  const sz = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: Math.min(szDecimals, 4), maximumFractionDigits: Math.min(szDecimals, 4) })
  const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour12: false })

  const failed = mode === 'error' && !book
  return (
    <section className="tx-panel tx-book" aria-label={t('盘口和最新成交')}>
      <div className="tx-tabs tx-tabs-fill" role="tablist" aria-label={t('盘口和最新成交')}>
        <button role="tab" aria-selected={tab === 'book'} className={`tx-tab ${tab === 'book' ? 'on' : ''}`} onClick={() => setTab('book')}>{t('盘口')}</button>
        <button role="tab" aria-selected={tab === 'trades'} className={`tx-tab ${tab === 'trades' ? 'on' : ''}`} onClick={() => setTab('trades')}>{t('最新成交')}</button>
      </div>
      <div className="tx-book-cols" aria-hidden="true">
        {tab === 'book'
          ? <><span>{t('价格')}</span><span className="r">{t('数量')}（{coin}）</span><span className="r">{t('合计')}</span></>
          : <><span>{t('价格')}</span><span className="r">{t('数量')}（{coin}）</span><span className="r">{t('时间')}</span></>}
      </div>
      <div ref={body} className="tx-book-body">
        {failed ? (
          <div className="tx-empty"><span>{t('暂时无法读取盘口')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button></div>
        ) : !book && !tape.length ? (
          <div className="tx-book-sk" aria-label={t('加载中')}>{Array.from({ length: rows * 2 }, (_, i) => <span key={i} className="tx-sk" />)}</div>
        ) : tab === 'book' ? (
          <div className="tx-book-ladder">
            <ol className="tx-book-side is-ask" aria-label={t('卖盘')}>
              {/* 卖盘倒着画：最贵的在最上面，最低卖价贴着中线 */}
              {asks.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
                <li key={l.px}>
                  <button type="button" className="tx-book-row" onClick={() => onPickPrice(l.px)} title={t('按这个价格挂限价单')}>
                    <i style={{ transform: `scaleX(${askCum[i] / maxCum})` }} />
                    <span className="down">{pxText(l.px)}</span><span className="r">{sz(l.sz)}</span><span className="r mute">{sz(askCum[i])}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="tx-book-mid" style={{ height: MID }}>
              <span className={`tx-book-last ${last ? (last.isBuy ? 'up' : 'down') : ''}`}>
                {last ? <>{pxText(last.px)}{last.isBuy ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</> : '--'}
              </span>
              {mark ? <span className="tx-book-mark" title={t('标记价格')}>{pxText(mark)}</span> : null}
              <span className="tx-book-spread">{spread !== undefined && bestBid ? <>{t('价差')} {pxText(spread)} <em>{((spread / bestBid) * 100).toFixed(3)}%</em></> : null}</span>
            </div>
            <ol className="tx-book-side is-bid" aria-label={t('买盘')}>
              {bids.map((l, i) => (
                <li key={l.px}>
                  <button type="button" className="tx-book-row" onClick={() => onPickPrice(l.px)} title={t('按这个价格挂限价单')}>
                    <i style={{ transform: `scaleX(${bidCum[i] / maxCum})` }} />
                    <span className="up">{pxText(l.px)}</span><span className="r">{sz(l.sz)}</span><span className="r mute">{sz(bidCum[i])}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <ol className="tx-tape" aria-label={t('最新成交')}>
            {tape.map((x) => (
              <li key={x.id} className={`tx-tape-row ${bigMin > 0 && x.px * x.sz >= bigMin ? (x.isBuy ? 'is-big is-buy' : 'is-big is-sell') : ''}`}>
                <span className={x.isBuy ? 'up' : 'down'}>{pxText(x.px)}</span><span className="r">{sz(x.sz)}</span><span className="r mute">{clock(x.time)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {mode === 'poll' && <p className="tx-book-note" role="status">{t('实时推送中断，每 1.5 秒刷新一次')}</p>}
    </section>
  )
}
