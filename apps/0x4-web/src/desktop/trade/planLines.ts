// "Trade plan lines" on the perp K-line chart (goat's first batch, 2026-10-02): calculations only here; PlanOverlay.tsx does the drawing.
//   - Existing: entry price, liquidation price, resting limit orders, TP/SL orders (all real exchange data)
//   - Pre-order preview: this order's entry, TP, SL, estimated liquidation (draws exactly what's in the order panel)
//   - Pending confirm: newly set / edited TP/SL on existing positions, drawn on the chart — only sent to the exchange after "confirm"
// PnL always estimated as "(target − entry) × qty", excluding fees and funding; the UI labels it "estimated".
import type { PerpOrder, PerpPosition } from '@/lib/aster'
import { t } from '@/lib/i18n'

export type ProtectKind = 'tp' | 'sl'
export type PlanRole = 'pos' | 'liq' | 'limit' | 'tp' | 'sl' | 'draftEntry' | 'draftTp' | 'draftSl' | 'draftLiq' | 'pendingTp' | 'pendingSl'

/** The order still unsent in the order panel */
export interface PlanDraft {
  isLong: boolean
  /** Entry price: the filled price for limit orders, current mark price for market orders */
  entry: number
  isLimit: boolean
  /** Coin quantity; 0 when not yet filled (draw the line, skip PnL) */
  size: number
  margin: number
  /** Estimated liquidation price; reduce-only orders don't have one */
  liq?: number
  tp?: number
  sl?: number
  reduceOnly?: boolean
}
/** TP/SL dragged out on the chart, unconfirmed (oid = the old order being replaced) */
export interface PlanPending { kind: ProtectKind; px: number; oid?: number }

export interface PlanLine {
  id: string
  role: PlanRole
  price: number
  /** Direction of the position / preview order */
  isLong?: boolean
  /** Side of the resting order */
  isBuy?: boolean
  size?: number
  reduceOnly?: boolean
  /** Estimated PnL (USDT) at this line, and its ratio to margin */
  pnl?: number
  pct?: number
  oid?: number
  /** Whether it can be dragged vertically */
  drag?: boolean
  /** Something wrong with this line (e.g. TP below current price): spelled out on the label */
  issue?: string
  /** The old order being edited: drawn faded */
  faded?: boolean
  /** What else can be attached to the position line */
  canAdd?: ProtectKind[]
}

export interface PlanInput {
  /** Current mark price (0 when unavailable; validation then compares against entry only) */
  mark: number
  position?: PerpPosition | null
  /** Current resting orders for this coin */
  orders: PerpOrder[]
  draft?: PlanDraft | null
  pending?: PlanPending | null
}

/** Order kind: limit, TP, SL — others (trailing stops etc.) aren't drawn */
export function orderKind(o: Pick<PerpOrder, 'trigger'>): 'limit' | ProtectKind | 'other' {
  const k = o.trigger
  if (!k || k === 'Limit' || k === 'LIMIT') return 'limit'
  if (/^TAKE_PROFIT/.test(k)) return 'tp'
  if (/^STOP/.test(k)) return 'sl'
  return 'other'
}

/** PnL when price reaches px (skipped without qty or entry price) */
export function estPnl(isLong: boolean, entry: number, px: number, size: number): number | undefined {
  if (!(entry > 0) || !(px > 0) || !(size > 0)) return undefined
  return (px - entry) * size * (isLong ? 1 : -1)
}
const pctOf = (pnl: number | undefined, margin: number) => pnl !== undefined && margin > 0 ? pnl / margin : undefined

/** Round to the exchange's price precision */
export function roundTick(px: number, pxDecimals: number): number {
  const d = Math.max(0, Math.min(12, Math.round(pxDecimals)))
  return Number(px.toFixed(d))
}

/**
 * Whether the TP/SL price is placed correctly. Returns a user-facing message when wrong, null when fine.
 * Exchange rule: TP/SL means "market-close on trigger" — a trigger already on the other side of the current
 * price would fire immediately, so it's rejected outright.
 *   Long: TP above current, SL below current; short is the reverse.
 * refs = prices to compare against (current; preview orders also add entry), zeros skipped.
 */
export function protectIssue(kind: ProtectKind, isLong: boolean, px: number, refs: number[]): string | null {
  if (!(px > 0)) return t('请输入价格')
  const live = refs.filter((r) => r > 0)
  if (!live.length) return null
  const needAbove = (kind === 'tp') === isLong
  if (needAbove && px <= Math.max(...live)) return kind === 'tp' ? t('止盈价要高于当前价') : t('止损价要高于当前价')
  if (!needAbove && px >= Math.min(...live)) return kind === 'tp' ? t('止盈价要低于当前价') : t('止损价要低于当前价')
  return null
}

/** SL farther than the liquidation price: liquidation hits before the SL (warn only, don't block) */
export function slBeyondLiq(isLong: boolean, sl: number, liq: number | null | undefined): boolean {
  if (!(sl > 0) || !liq || !(liq > 0)) return false
  return isLong ? sl <= liq : sl >= liq
}

/**
 * Prices the auto-zoom should also frame: entry, orders, TP/SL, preview lines. Liquidation price excluded
 * (usually far away — not worth squashing the candles for). Only pull in what's "not too far" from the
 * candles: extend at most stretch × the candles' own height upward/downward; farther ones stay at the edge
 * with an arrow marker.
 */
export function stretchRange(min: number, max: number, prices: number[], stretch = 1): { min: number; max: number } {
  const span = max - min
  if (!(span > 0)) return { min, max }
  let lo = min, hi = max
  for (const p of prices) {
    if (!(p > 0)) continue
    if (p > hi && p <= max + span * stretch) hi = p
    if (p < lo && p >= min - span * stretch) lo = p
  }
  return { min: lo, max: hi }
}
export const scalePrices = (lines: PlanLine[]) => lines.filter((l) => l.role !== 'liq' && l.role !== 'draftLiq').map((l) => l.price)

/** Which lines to draw. Order = leftmost when labels crowd: pending-confirm > preview > orders > position */
export function buildPlan({ mark, position, orders, draft, pending }: PlanInput): PlanLine[] {
  const out: PlanLine[] = []
  const pos = position && position.size > 0 ? position : null
  const posPnl = (px: number) => pos ? estPnl(pos.isLong, pos.entryPx, px, pos.size) : undefined
  const warnSl = (isLong: boolean, px: number, liq: number | null | undefined) => slBeyondLiq(isLong, px, liq) ? t('比强平价还远，会先被强平') : undefined

  if (pending && pos && pending.px > 0) {
    const pnl = posPnl(pending.px)
    out.push({
      id: 'pending', role: pending.kind === 'tp' ? 'pendingTp' : 'pendingSl', price: pending.px, isLong: pos.isLong, pnl, pct: pctOf(pnl, pos.marginUsed), drag: true, oid: pending.oid,
      issue: protectIssue(pending.kind, pos.isLong, pending.px, [mark]) ?? (pending.kind === 'sl' ? warnSl(pos.isLong, pending.px, pos.liquidationPx) : undefined),
    })
  }

  if (draft && draft.entry > 0) {
    out.push({ id: 'd-entry', role: 'draftEntry', price: draft.entry, isLong: draft.isLong, size: draft.size, reduceOnly: draft.reduceOnly, drag: draft.isLimit })
    const refs = [mark, draft.entry]
    for (const kind of ['tp', 'sl'] as const) {
      const px = draft[kind]
      // Reduce-only orders carry no TP/SL
      if (draft.reduceOnly || !px || !(px > 0)) continue
      const pnl = estPnl(draft.isLong, draft.entry, px, draft.size)
      out.push({
        id: `d-${kind}`, role: kind === 'tp' ? 'draftTp' : 'draftSl', price: px, isLong: draft.isLong, pnl, pct: pctOf(pnl, draft.margin), drag: true,
        issue: protectIssue(kind, draft.isLong, px, refs) ?? (kind === 'sl' ? warnSl(draft.isLong, px, draft.liq) : undefined),
      })
    }
    if (draft.liq && draft.liq > 0 && draft.size > 0 && !draft.reduceOnly) out.push({ id: 'd-liq', role: 'draftLiq', price: draft.liq, isLong: draft.isLong })
  }

  const has: Record<ProtectKind, boolean> = { tp: false, sl: false }
  for (const o of orders) {
    const kind = orderKind(o)
    if (kind === 'other' || !(o.limitPx > 0)) continue
    if (kind === 'limit') { out.push({ id: `o${o.oid}`, role: 'limit', price: o.limitPx, isBuy: o.isBuy, size: o.size, reduceOnly: o.reduceOnly, oid: o.oid }); continue }
    has[kind] = true
    const pnl = posPnl(o.limitPx)
    // TP/SL can only be drag-edited with a position open (they're "close the whole position" orders)
    out.push({ id: `o${o.oid}`, role: kind, price: o.limitPx, isBuy: o.isBuy, isLong: pos?.isLong, pnl, pct: pctOf(pnl, pos?.marginUsed ?? 0), oid: o.oid, drag: !!pos, faded: pending?.oid === o.oid })
  }

  if (pos && pos.entryPx > 0) {
    const canAdd = (['tp', 'sl'] as const).filter((k) => !has[k] && pending?.kind !== k)
    out.push({ id: 'pos', role: 'pos', price: pos.entryPx, isLong: pos.isLong, size: pos.size, pnl: pos.unrealizedPnl, pct: pos.roe, canAdd })
    if (pos.liquidationPx && pos.liquidationPx > 0) out.push({ id: 'liq', role: 'liq', price: pos.liquidationPx, isLong: pos.isLong })
  }
  return out
}

export interface PlacedLine {
  id: string
  /** The line's true y (line hidden beyond the visible range, label kept) */
  y: number
  /** Label y: clamped inside the chart, clearing the top-left OHLC readout */
  chipY: number
  /** Line outside the visible range: label pinned to the top/bottom edge with an arrow and the price */
  pinned: 'top' | 'bottom' | null
  /** How far right the label shifts (when crowded with other labels) */
  offset: number
}

/**
 * Lay the lines onto the chart: y = price-derived vertical position (null = chart not ready, skip this line).
 * Labels go on the chart's left (the right side has the newest candles — don't cover them); when crowded
 * (closer than gap), shift right one by one so they never overlap.
 * When one row overflows (wider than maxW), wrap to the next row (upper ones wrap down, lower ones wrap up).
 * widths = measured label widths (defW before the first measure); top = highest the labels may go (clearing
 * the top-left OHLC row).
 */
export function placeLines(lines: { id: string; y: number | null }[], paneH: number, widths: Record<string, number>, maxW = Infinity, gap = 24, defW = 150, top = 36): PlacedLine[] {
  const bottom = 13
  const out: PlacedLine[] = []
  if (paneH <= top + bottom) return out
  for (const l of lines) {
    if (l.y === null || !Number.isFinite(l.y)) continue
    const pinned = l.y < 0 ? 'top' : l.y > paneH ? 'bottom' : null
    let chipY = Math.max(top, Math.min(paneH - bottom, l.y))
    let offset = 0
    for (let tries = 0; tries < 10; tries++) {
      offset = 0
      for (const p of out) if (Math.abs(p.chipY - chipY) < gap) offset = Math.max(offset, p.offset + (widths[p.id] ?? defW) + 6)
      if (offset === 0 || offset + (widths[l.id] ?? defW) <= maxW) break
      const next = chipY + (chipY < paneH / 2 ? gap : -gap)
      if (next < top || next > paneH - bottom) break
      chipY = next
    }
    out.push({ id: l.id, y: l.y, chipY, pinned, offset })
  }
  return out
}
