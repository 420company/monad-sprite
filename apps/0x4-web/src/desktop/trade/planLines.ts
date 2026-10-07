// 合约 K 线上的「交易计划线」（2026-10-02 goat 第一批）：这里只做计算，画在图上是 PlanOverlay.tsx。
//   · 已有的：开仓价、强平价、挂着的限价单、止盈 / 止损单（都是交易所回来的真实数据）
//   · 下单前预览：这一单的入场价、止盈、止损、预估强平价（下单面板里填了什么就画什么）
//   · 待确认：在图上给已有仓位新设 / 改动的止盈止损，点了「确认」才真正发给交易所
// 盈亏一律按「（目标价 − 开仓价）× 数量」估算，不含手续费和资金费，界面上写「预计」。
import type { PerpOrder, PerpPosition } from '@/lib/aster'
import { t } from '@/lib/i18n'

export type ProtectKind = 'tp' | 'sl'
export type PlanRole = 'pos' | 'liq' | 'limit' | 'tp' | 'sl' | 'draftEntry' | 'draftTp' | 'draftSl' | 'draftLiq' | 'pendingTp' | 'pendingSl'

/** 下单面板里还没发出去的这一单 */
export interface PlanDraft {
  isLong: boolean
  /** 入场价：限价单是填的价格，市价单是当前标记价 */
  entry: number
  isLimit: boolean
  /** 币的数量；还没填数量时是 0（只画线，不算盈亏） */
  size: number
  margin: number
  /** 预估强平价；只减仓的单没有 */
  liq?: number
  tp?: number
  sl?: number
  reduceOnly?: boolean
}
/** 图上拖出来、还没确认的止盈 / 止损（oid = 要替换掉的那张旧单） */
export interface PlanPending { kind: ProtectKind; px: number; oid?: number }

export interface PlanLine {
  id: string
  role: PlanRole
  price: number
  /** 仓位 / 预览单的方向 */
  isLong?: boolean
  /** 委托单的买卖方向 */
  isBuy?: boolean
  size?: number
  reduceOnly?: boolean
  /** 到这条线时的预计盈亏（USDT）和相对保证金的比例 */
  pnl?: number
  pct?: number
  oid?: number
  /** 能不能上下拖 */
  drag?: boolean
  /** 这条线有问题（比如止盈价低于现价）：标签上直接写出来 */
  issue?: string
  /** 正在被改动的旧单：画淡一点 */
  faded?: boolean
  /** 仓位线上还可以补挂哪几样 */
  canAdd?: ProtectKind[]
}

export interface PlanInput {
  /** 当前标记价（拿不到传 0，校验时就只和开仓价比） */
  mark: number
  position?: PerpPosition | null
  /** 当前这个币的委托 */
  orders: PerpOrder[]
  draft?: PlanDraft | null
  pending?: PlanPending | null
}

/** 委托单属于哪一种：限价、止盈、止损，其余（追踪止损等）不画 */
export function orderKind(o: Pick<PerpOrder, 'trigger'>): 'limit' | ProtectKind | 'other' {
  const k = o.trigger
  if (!k || k === 'Limit' || k === 'LIMIT') return 'limit'
  if (/^TAKE_PROFIT/.test(k)) return 'tp'
  if (/^STOP/.test(k)) return 'sl'
  return 'other'
}

/** 价格到 px 时的盈亏（没有数量或开仓价时不算） */
export function estPnl(isLong: boolean, entry: number, px: number, size: number): number | undefined {
  if (!(entry > 0) || !(px > 0) || !(size > 0)) return undefined
  return (px - entry) * size * (isLong ? 1 : -1)
}
const pctOf = (pnl: number | undefined, margin: number) => pnl !== undefined && margin > 0 ? pnl / margin : undefined

/** 按交易所的价格精度取整 */
export function roundTick(px: number, pxDecimals: number): number {
  const d = Math.max(0, Math.min(12, Math.round(pxDecimals)))
  return Number(px.toFixed(d))
}

/**
 * 止盈 / 止损价放得对不对。不对返回一句给用户看的话，对返回 null。
 * 交易所的规矩：止盈止损是「触发后市价平仓」，触发价已经在现价的另一边就会被当场触发，所以直接拒掉。
 *   做多：止盈要高于现价，止损要低于现价；做空反过来。
 * refs = 要比较的几个价（现价；预览单再加上入场价），0 的不比。
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

/** 止损比强平价还远：到不了止损就先被强平了（只提醒，不拦） */
export function slBeyondLiq(isLong: boolean, sl: number, liq: number | null | undefined): boolean {
  if (!(sl > 0) || !liq || !(liq > 0)) return false
  return isLong ? sl <= liq : sl >= liq
}

/**
 * 图表自动缩放时要顺带照顾到的价格：开仓价、委托、止盈止损、预览线。强平价不算（通常离得远，为了它把 K 线压扁不值得）。
 * 只把「离 K 线不太远」的拉进来：往上、往下最多各扩出 K 线本身高度的 stretch 倍，更远的留在边缘用箭头标。
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

/** 该画哪些线。顺序 = 标签挤在一起时谁排在最靠左：待确认的 > 预览 > 委托 > 仓位 */
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
      // 只减仓的单不带止盈止损
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
    // 止盈止损只有在有仓位时才能拖着改（它们是「平掉整个仓位」的单）
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
  /** 线的真实纵坐标（超出可见范围时线不画，只留标签） */
  y: number
  /** 标签的纵坐标：夹在图里面，上面让开左上角的开高低收 */
  chipY: number
  /** 线在可见范围外面：标签贴在上 / 下边缘，带箭头和价格 */
  pinned: 'top' | 'bottom' | null
  /** 标签往右错开多少（和别的标签挤在一起时） */
  offset: number
}

/**
 * 把线摆到图上：y = 价格换出来的纵坐标（null = 图表还没准备好，这条先不画）。
 * 标签在图的左侧（右侧是最新的 K 线，不去挡）；挤在一起（相距不到 gap）时依次往右错开，不互相盖住。
 * 一行排不下（超过 maxW）就换到下一行（靠上的往下换、靠下的往上换）。
 * widths = 各标签量出来的宽度（第一次还没量，按 defW 算）；top = 标签最高能到哪（让开左上角那行开高低收）。
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
