// Trade plan lines on the K-line chart (goat's first batch, 2026-10-02): a layer over the chart; lines and labels are plain DOM elements (not chart-library drawings),
// so they're draggable, clickable, and labels can hold buttons. Y positions are re-asked from the chart every frame (the chart library emits no events for axis zoom / pan / new candles).
//   - Labels on the chart's left (the right side has the newest candles — don't cover them); prices written on the right price axis
//   - Line beyond the visible price range: label pinned to the top/bottom edge with an arrow and the price — never squash the candles for it
//   - Crowded labels: shift right one by one
//   - Draggable lines (preview limit / TP / SL, resting TP/SL): drag the line or the label; arrow keys nudge
//   - "Pick price on chart": the whole chart becomes a price picker; the dashed line following the cursor shows this price's estimated PnL — click to pick, Esc / right-click cancels
// No trading requests are sent here: dragging only reports prices back; orders really change after "confirm" on the perp page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, X } from 'lucide-react'
import { fmtAmount } from '@/lib/format'
import { t } from '@/lib/i18n'
import { placeLines, roundTick, type PlanLine, type PlanRole, type ProtectKind } from './planLines'

/** "Pick price on chart": kind decides color and text; at(px) gives this price's estimated PnL and issues (e.g. below current) */
export interface PlanPick { kind: ProtectKind; at?: (px: number) => { pnl?: number; pct?: number; issue?: string | null } }

export interface PlanProps {
  lines: PlanLine[]
  coin: string
  pxDecimals: number
  /** Called on every price change while dragging (already rounded to exchange precision) */
  onMove?: (line: PlanLine, px: number) => void
  onCancelOrder?: (oid: number) => void
  /** "TP / SL" on the position line: start picking a price on the chart */
  onAdd?: (kind: ProtectKind) => void
  /** Pending TP/SL: confirm / discard */
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
/** The PnL snippet: the position line shows current unrealized PnL; the rest show "at this line" estimated PnL */
function noteOf(l: Pick<PlanLine, 'pnl' | 'pct'>, live: boolean): { text: string; up: boolean } | null {
  if (l.pnl === undefined || !Number.isFinite(l.pnl)) return null
  const pct = l.pct !== undefined && Number.isFinite(l.pct) ? ` (${pctText(l.pct)})` : ''
  return { text: live ? `${money(l.pnl)} USDT${pct}` : t('预计 {v} USDT', { v: money(l.pnl) }) + pct, up: l.pnl >= 0 }
}

interface Geo { w: number; paneH: number; axisW: number; ys: Record<string, number | null> }

export default function PlanOverlay({ chart, series, formatPrice, onDragging, lines, coin, pxDecimals, onMove, onCancelOrder, onAdd, onConfirm, onDiscard, busy, pick, onPick, onPickCancel }: PlanProps & {
  chart: RefObject<IChartApi | null>; series: RefObject<ISeriesApi<'Candlestick'> | null>; formatPrice: (n: number) => string
  /** Line being dragged: the chart must not re-zoom meanwhile (the line would slip from under the finger) */
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

  // Ask the chart every frame "which pixel are these prices at now"; repaint only on change
  useEffect(() => {
    if (!active) return
    let raf = 0, last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const c = chart.current, s = series.current, el = host.current
      if (!c || !s || !el) return
      // Height of the candle pane (a "buy/sell pressure" pane may sit below — don't use the whole container height)
      const w = el.clientWidth, paneH = c.panes()[0]?.getHeight() ?? el.clientHeight - c.timeScale().height(), axisW = c.priceScale('right').width()
      const ys: Record<string, number | null> = {}
      for (const l of linesRef.current) { const y = s.priceToCoordinate(l.price); ys[l.id] = y === null ? null : Math.round(y * 2) / 2 }
      const sig = `${w}|${paneH}|${axisW}|${Object.entries(ys).join(';')}`
      if (sig !== last) { last = sig; setGeo({ w, paneH, axisW, ys }) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, chart, series])

  // Measure label widths: shifting needs the previous label's width
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
    // Under 3px of jitter doesn't count as a drag (tapping a label shouldn't move the price)
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
  /** Keyboard nudge: arrow keys move 0.05% per press (at least one tick), x10 with Shift held */
  const key = (l: PlanLine) => (e: KeyboardEvent<HTMLElement>) => {
    if (!l.drag || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target !== e.currentTarget) return
    e.preventDefault()
    const step = Math.max(10 ** -pxDecimals, l.price * 0.0005) * (e.shiftKey ? 10 : 1)
    const px = roundTick(l.price + (e.key === 'ArrowUp' ? step : -step), pxDecimals)
    if (px > 0) onMove?.(l, px)
  }

  // Price-pick mode: Esc cancels
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
