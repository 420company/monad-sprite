// K 线上的交易计划线（2026-10-02 goat 第一批）：盖在图表上面的一层，线和标签是普通的页面元素（不是图表库画的），
// 所以能拖、能点、标签里能放按钮。纵坐标每一帧向图表问一次（价格轴缩放 / 拖动 / 新 K 线进来，图表库都不发通知）。
//   · 标签在图的左侧（右侧是最新的 K 线，不去挡），价格写在右边的价格轴上
//   · 线超出当前可见的价格范围：标签贴在上 / 下边缘，带箭头和价格，不为了它把 K 线压扁
//   · 标签挤在一起：依次往右错开
//   · 能拖的线（预览里的限价 / 止盈 / 止损、已挂的止盈止损）：拖线或拖标签都行，键盘上下键微调
//   · 「在图上选价格」：整块图变成选价区，跟着鼠标的虚线上写着这个价的预计盈亏，点一下选定，Esc / 右键取消
// 这里不发任何交易请求：拖动只回调价格，真正改单在合约页里点「确认」之后。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, X } from 'lucide-react'
import { fmtAmount } from '@/lib/format'
import { t } from '@/lib/i18n'
import { placeLines, roundTick, type PlanLine, type PlanRole, type ProtectKind } from './planLines'

/** 「在图上选价格」：kind 决定颜色和文字；at(px) 给出这个价的预计盈亏和问题（比如低于现价） */
export interface PlanPick { kind: ProtectKind; at?: (px: number) => { pnl?: number; pct?: number; issue?: string | null } }

export interface PlanProps {
  lines: PlanLine[]
  coin: string
  pxDecimals: number
  /** 拖动中，价格每变一次调一次（已经按交易所精度取整） */
  onMove?: (line: PlanLine, px: number) => void
  onCancelOrder?: (oid: number) => void
  /** 仓位线上的「止盈 / 止损」：开始在图上选价格 */
  onAdd?: (kind: ProtectKind) => void
  /** 待确认的止盈止损：确认 / 放弃 */
  onConfirm?: () => void
  onDiscard?: () => void
  busy?: boolean
  pick?: PlanPick | null
  onPick?: (px: number) => void
  onPickCancel?: () => void
}

const TONE: Record<PlanRole, 'up' | 'down' | 'warn' | 'accent' | 'side'> = {
  pos: 'side', liq: 'warn', limit: 'side', tp: 'up', sl: 'down', draftEntry: 'accent', draftTp: 'up', draftSl: 'down', draftLiq: 'warn', pendingTp: 'up', pendingSl: 'down',
}
const STYLE: Partial<Record<PlanRole, 'dashed' | 'dotted'>> = { liq: 'dotted', draftEntry: 'dashed', draftTp: 'dashed', draftSl: 'dashed', draftLiq: 'dotted', pendingTp: 'dashed', pendingSl: 'dashed' }
const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pctText = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`

function labelOf(l: PlanLine, coin: string): string {
  const sz = l.size && l.size > 0 ? ` ${fmtAmount(l.size)}` : ''
  switch (l.role) {
    case 'pos': return `${l.isLong ? t('多') : t('空')}${sz} ${coin}`
    case 'liq': return t('强平价')
    case 'limit': return `${l.isBuy ? t('限价买入') : t('限价卖出')}${sz}${l.reduceOnly ? ` · ${t('只减仓')}` : ''}`
    case 'tp': return t('止盈')
    case 'sl': return t('止损')
    case 'draftEntry': return `${l.reduceOnly ? t('只减仓（预览）') : l.isLong ? t('做多（预览）') : t('做空（预览）')}${sz}`
    case 'draftTp': return t('止盈（预览）')
    case 'draftSl': return t('止损（预览）')
    case 'draftLiq': return t('预估强平价')
    case 'pendingTp': return l.oid !== undefined ? t('止盈改到') : t('新止盈')
    case 'pendingSl': return l.oid !== undefined ? t('止损改到') : t('新止损')
  }
}
const toneOf = (l: PlanLine) => { const x = TONE[l.role]; return x !== 'side' ? x : (l.role === 'pos' ? l.isLong : l.isBuy) ? 'up' : 'down' }
/** 盈亏那一小段：仓位线是现在的浮动盈亏，其余是「到这条线时」的预计盈亏 */
function noteOf(l: Pick<PlanLine, 'pnl' | 'pct'>, live: boolean): { text: string; up: boolean } | null {
  if (l.pnl === undefined || !Number.isFinite(l.pnl)) return null
  const pct = l.pct !== undefined && Number.isFinite(l.pct) ? ` (${pctText(l.pct)})` : ''
  return { text: live ? `${money(l.pnl)} USDT${pct}` : t('预计 {v} USDT', { v: money(l.pnl) }) + pct, up: l.pnl >= 0 }
}

interface Geo { w: number; paneH: number; axisW: number; ys: Record<string, number | null> }

export default function PlanOverlay({ chart, series, formatPrice, onDragging, lines, coin, pxDecimals, onMove, onCancelOrder, onAdd, onConfirm, onDiscard, busy, pick, onPick, onPickCancel }: PlanProps & {
  chart: RefObject<IChartApi | null>; series: RefObject<ISeriesApi<'Candlestick'> | null>; formatPrice: (n: number) => string
  /** 正在拖线：图表这时候不要跟着重新缩放（线会从手底下跑掉） */
  onDragging?: (on: boolean) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const [geo, setGeo] = useState<Geo>({ w: 0, paneH: 0, axisW: 0, ys: {} })
  const [widths, setWidths] = useState<Record<string, number>>({})
  const chips = useRef(new Map<string, HTMLDivElement>())
  const drag = useRef<{ id: string; startY: number; moved: boolean } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{ y: number; px: number } | null>(null)
  const active = lines.length > 0 || !!pick

  // 每一帧问图表「这些价格现在在第几个像素」，有变化才重画
  useEffect(() => {
    if (!active) return
    let raf = 0, last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const c = chart.current, s = series.current, el = host.current
      if (!c || !s || !el) return
      // K 线那一栏的高度（下面可能还有「买卖力量」一栏，不能拿整个容器的高度算）
      const w = el.clientWidth, paneH = c.panes()[0]?.getHeight() ?? el.clientHeight - c.timeScale().height(), axisW = c.priceScale('right').width()
      const ys: Record<string, number | null> = {}
      for (const l of linesRef.current) { const y = s.priceToCoordinate(l.price); ys[l.id] = y === null ? null : Math.round(y * 2) / 2 }
      const sig = `${w}|${paneH}|${axisW}|${Object.entries(ys).join(';')}`
      if (sig !== last) { last = sig; setGeo({ w, paneH, axisW, ys }) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, chart, series])

  // 量标签宽度：错开时要知道前一个标签占了多宽
  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    let changed = false
    for (const [id, el] of chips.current) { next[id] = el.offsetWidth; if (Math.abs((widths[id] ?? -1) - next[id]) > 1) changed = true }
    if (changed || Object.keys(widths).length !== Object.keys(next).length) setWidths(next)
  })

  const placed = useMemo(() => placeLines(lines.map((l) => ({ id: l.id, y: geo.ys[l.id] ?? null })), geo.paneH, widths, geo.w - geo.axisW - 16), [lines, geo, widths])
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])

  const priceAt = (clientY: number): { y: number; px: number } | null => {
    const el = host.current, s = series.current
    if (!el || !s || geo.paneH <= 0) return null
    const y = Math.max(2, Math.min(geo.paneH - 2, clientY - el.getBoundingClientRect().top))
    const raw = s.coordinateToPrice(y)
    if (raw === null || !(raw > 0)) return null
    const px = roundTick(raw, pxDecimals)
    return px > 0 ? { y, px } : null
  }

  const down = (l: PlanLine) => (e: PointerEvent<HTMLElement>) => {
    if (!l.drag || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: l.id, startY: e.clientY, moved: false }
    setDragId(l.id)
    onDragging?.(true)
  }
  const move = (l: PlanLine) => (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== l.id) return
    // 手抖 3 像素以内不算拖（点一下标签不应该把价格挪走）
    if (!d.moved && Math.abs(e.clientY - d.startY) < 3) return
    d.moved = true
    const at = priceAt(e.clientY)
    if (at) onMove?.(l, at.px)
  }
  const up = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    setDragId(null)
    onDragging?.(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  /** 键盘微调：上下键每次 0.05%（至少一格），按住 Shift 十倍 */
  const key = (l: PlanLine) => (e: KeyboardEvent<HTMLElement>) => {
    if (!l.drag || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target !== e.currentTarget) return
    e.preventDefault()
    const step = Math.max(10 ** -pxDecimals, l.price * 0.0005) * (e.shiftKey ? 10 : 1)
    const px = roundTick(l.price + (e.key === 'ArrowUp' ? step : -step), pxDecimals)
    if (px > 0) onMove?.(l, px)
  }

  // 选价模式：Esc 取消
  useEffect(() => {
    if (!pick) { setGhost(null); return }
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onPickCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick, onPickCancel])

  if (!active) return null
  const ghostInfo = pick && ghost ? pick.at?.(ghost.px) : undefined
  const ghostNote = ghostInfo ? noteOf(ghostInfo, false) : null
  return (
    <div ref={host} className="tx-plan" style={{ ['--plan-axis' as string]: `${geo.axisW}px` }}>
      {placed.map((p) => {
        const l = byId.get(p.id)
        if (!l) return null
        const note = noteOf(l, l.role === 'pos')
        const pending = l.role === 'pendingTp' || l.role === 'pendingSl'
        const handlers = l.drag ? { onPointerDown: down(l), onPointerMove: move(l), onPointerUp: up, onPointerCancel: up } : {}
        return (
          <div key={l.id} className={`tx-plan-line is-${toneOf(l)} ${STYLE[l.role] ? `is-${STYLE[l.role]}` : ''} ${l.faded ? 'is-faded' : ''} ${dragId === l.id ? 'is-drag' : ''} ${pending ? 'is-pending' : ''}`}>
            {!p.pinned && <i className="tx-plan-rule" style={{ top: p.y }} aria-hidden="true" />}
            {l.drag && !p.pinned && <div className="tx-plan-hit" style={{ top: p.y - 4 }} aria-hidden="true" {...handlers} />}
            <div ref={(el) => { if (el) chips.current.set(l.id, el); else chips.current.delete(l.id) }} className={`tx-plan-chip ${l.drag ? 'can-drag' : ''}`} style={{ top: p.chipY, left: 8 + p.offset }}
              {...handlers} onKeyDown={key(l)}
              {...(l.drag ? { tabIndex: 0, role: 'slider', 'aria-orientation': 'vertical' as const, 'aria-valuenow': l.price, 'aria-valuetext': formatPrice(l.price), 'aria-label': t('{name}：上下拖动或按上下键调整价格', { name: labelOf(l, coin) }) } : {})}>
              {l.drag && <GripVertical size={11} className="tx-plan-grip" aria-hidden="true" />}
              {p.pinned === 'top' && <ArrowUp size={11} aria-hidden="true" />}
              {p.pinned === 'bottom' && <ArrowDown size={11} aria-hidden="true" />}
              <b>{labelOf(l, coin)}</b>
              {(p.pinned || pending) && <span className="tx-plan-px">{formatPrice(l.price)}</span>}
              {note && <span className={note.up ? 'up' : 'down'}>{note.text}</span>}
              {l.issue && <em>{l.issue}</em>}
              {l.role === 'pos' && l.canAdd?.map((k) => (
                <button key={k} type="button" className="tx-plan-btn is-text" onClick={() => onAdd?.(k)} title={k === 'tp' ? t('在图上选止盈价') : t('在图上选止损价')}><Plus size={10} aria-hidden="true" />{k === 'tp' ? t('止盈') : t('止损')}</button>
              ))}
              {pending && <>
                <button type="button" className="tx-plan-btn is-go" disabled={busy} onClick={onConfirm}><Check size={11} aria-hidden="true" />{busy ? t('处理中…') : t('确认')}</button>
                <button type="button" className="tx-plan-btn" disabled={busy} onClick={onDiscard} aria-label={t('放弃改动')} title={t('放弃改动')}><X size={11} aria-hidden="true" /></button>
              </>}
              {!pending && l.oid !== undefined && !l.faded && <button type="button" className="tx-plan-btn" onClick={() => onCancelOrder?.(l.oid!)} aria-label={t('撤单')} title={t('撤单')}><X size={11} aria-hidden="true" /></button>}
            </div>
            {!p.pinned && <span className="tx-plan-tag" style={{ top: p.y }} aria-hidden="true">{formatPrice(l.price)}</span>}
          </div>
        )
      })}
      {pick && (
        <div className={`tx-plan-pick is-${pick.kind === 'tp' ? 'up' : 'down'}`} style={{ height: Math.max(0, geo.paneH) }}
          onPointerMove={(e) => setGhost(priceAt(e.clientY))} onPointerLeave={() => setGhost(null)}
          onClick={(e) => { const at = priceAt(e.clientY); if (at) onPick?.(at.px) }}
          onContextMenu={(e) => { e.preventDefault(); onPickCancel?.() }}>
          <div className="tx-plan-tip" role="status">
            <span>{pick.kind === 'tp' ? t('在图上点一下，选止盈价') : t('在图上点一下，选止损价')}</span>
            <button type="button" className="tx-plan-btn is-text" onClick={(e) => { e.stopPropagation(); onPickCancel?.() }}>{t('取消')}<kbd>Esc</kbd></button>
          </div>
          {ghost && <div className={`tx-plan-line is-${pick.kind === 'tp' ? 'up' : 'down'} is-dashed is-ghost`}>
            <i className="tx-plan-rule" style={{ top: ghost.y }} aria-hidden="true" />
            <div className="tx-plan-chip" style={{ top: Math.max(36, Math.min(geo.paneH - 13, ghost.y)), left: 8 }}>
              <b>{pick.kind === 'tp' ? t('止盈') : t('止损')}</b>
              {ghostNote && <span className={ghostNote.up ? 'up' : 'down'}>{ghostNote.text}</span>}
              {ghostInfo?.issue && <em>{ghostInfo.issue}</em>}
            </div>
            <span className="tx-plan-tag" style={{ top: ghost.y }} aria-hidden="true">{formatPrice(ghost.px)}</span>
          </div>}
        </div>
      )}
    </div>
  )
}
