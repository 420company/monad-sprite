// In-meeting pen annotations (2026-09-30 goat: the presenter marks key points on our meeting page, not inside the shared app).
// Pure logic only here (coordinate conversion, message validation, stroke state); canvas and toolbar live in AnnotationLayer.tsx, synced over the meeting's existing data channel (lk.ts packData).
//
// Rules:
//   - Who can draw: the current screen sharer, or the meeting host. On receive, judge by the sender identity from the AV service (participant.identity), never the message's self-claim.
//   - Coordinates normalized to 0..1 against the shared view's "actually displayed content area" (object-fit: contain may letterbox),
//     so annotations land on the same spot of the picture for everyone regardless of window size.
//   - While drawing, send an incremental segment (~50ms); pen-up sends end; undo removes only the sender's own last stroke; clear wipes everything.
//   - Late joiners: the sharer replays existing strokes once (sync, chunked, each under the data channel's per-message cap; laser pointer excluded).
//   - Share stopped / sharer changed: everyone clears locally, no message needed.

export type AnnTool = 'pen' | 'laser'
export type AnnColor = 'red' | 'yellow' | 'green'
export const ANN_COLORS: Record<AnnColor, string> = { red: '#ff4d5e', yellow: '#ffd23f', green: '#3ddc84' }
/** How long after pen-up the laser pointer fades out */
export const LASER_FADE_MS = 3000
/** Max numbers per stroke (x and y count separately): 600 points; a normal circle is tens to ~200 points */
export const MAX_STROKE_NUMS = 1200
/** Max strokes kept at once (oldest dropped first) */
export const MAX_STROKES = 300
/** Safe per-message cap (bytes) for the data channel; replays chunk by this */
export const SYNC_CHUNK_BYTES = 12_000

export interface Stroke { id: string; by: string; tool: AnnTool; color: AnnColor; pts: number[]; endAt: number | null }
export type SyncStroke = Pick<Stroke, 'id' | 'by' | 'tool' | 'color' | 'pts'>
export type AnnMsg =
  | { t: 'ann'; k: 'seg'; id: string; tool: AnnTool; color: AnnColor; pts: number[] }
  | { t: 'ann'; k: 'end'; id: string }
  | { t: 'ann'; k: 'undo' }
  | { t: 'ann'; k: 'clear' }
  | { t: 'ann'; k: 'sync'; reset: boolean; strokes: SyncStroke[] }

/** Whether the sender may draw: is the current screen sharer, or the host */
export function canAnnotate(identity: string | undefined | null, sharerId: string | null | undefined, hostId: string | null | undefined): boolean {
  if (!identity) return false
  return (!!sharerId && identity === sharerId) || (!!hostId && identity === hostId)
}

// ---------- Coordinates ----------
export interface Rect { x: number; y: number; w: number; h: number }
/** The area video content actually occupies in the container under object-fit: contain (container coords). Whole container until video dimensions are known */
export function contentRect(cw: number, ch: number, vw: number, vh: number): Rect {
  if (!(cw > 0 && ch > 0)) return { x: 0, y: 0, w: 0, h: 0 }
  if (!(vw > 0 && vh > 0)) return { x: 0, y: 0, w: cw, h: ch }
  const s = Math.min(cw / vw, ch / vh)
  const w = vw * s, h = vh * s
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
}
const q4 = (n: number) => Math.round(n * 10000) / 10000
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)
/** Container coords → normalized (0..1, 4 decimals; clamped to the content area) */
export function toNorm(px: number, py: number, r: Rect): [number, number] {
  if (!(r.w > 0 && r.h > 0)) return [0, 0]
  return [q4(clamp01((px - r.x) / r.w)), q4(clamp01((py - r.y) / r.h))]
}
/** Normalized → container coords */
export function fromNorm(nx: number, ny: number, r: Rect): [number, number] {
  return [r.x + nx * r.w, r.y + ny * r.h]
}

// ---------- Message validation ----------
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/
const isTool = (x: unknown): x is AnnTool => x === 'pen' || x === 'laser'
const isColor = (x: unknown): x is AnnColor => x === 'red' || x === 'yellow' || x === 'green'
function cleanPts(x: unknown, max: number): number[] | null {
  if (!Array.isArray(x) || x.length % 2 !== 0 || x.length > max) return null
  for (const n of x) if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return null
  return x as number[]
}
/** Whether a received data message is a valid annotation message; null when invalid (bad shape, out-of-range coords, too many points — all dropped) */
export function sanitizeAnn(d: unknown): AnnMsg | null {
  if (!d || typeof d !== 'object') return null
  const m = d as Record<string, unknown>
  if (m.t !== 'ann') return null
  switch (m.k) {
    case 'seg': {
      const pts = cleanPts(m.pts, 400)
      if (typeof m.id !== 'string' || !ID_RE.test(m.id) || !isTool(m.tool) || !isColor(m.color) || !pts) return null
      return { t: 'ann', k: 'seg', id: m.id, tool: m.tool, color: m.color, pts }
    }
    case 'end': return typeof m.id === 'string' && ID_RE.test(m.id) ? { t: 'ann', k: 'end', id: m.id } : null
    case 'undo': return { t: 'ann', k: 'undo' }
    case 'clear': return { t: 'ann', k: 'clear' }
    case 'sync': {
      if (typeof m.reset !== 'boolean' || !Array.isArray(m.strokes) || m.strokes.length > MAX_STROKES) return null
      const strokes: SyncStroke[] = []
      for (const s of m.strokes as Record<string, unknown>[]) {
        if (!s || typeof s !== 'object') return null
        const pts = cleanPts(s.pts, MAX_STROKE_NUMS)
        if (typeof s.id !== 'string' || !ID_RE.test(s.id) || typeof s.by !== 'string' || s.by.length > 128 || !isTool(s.tool) || !isColor(s.color) || !pts) return null
        strokes.push({ id: s.id, by: s.by, tool: s.tool, color: s.color, pts })
      }
      return { t: 'ann', k: 'sync', reset: m.reset, strokes }
    }
    default: return null
  }
}

// ---------- State ----------
/** Apply one message to the strokes (sender = AV-service identity). Pure function, returns a new array */
export function applyAnn(strokes: Stroke[], m: AnnMsg, sender: string, now: number): Stroke[] {
  switch (m.k) {
    case 'seg': {
      const i = strokes.findIndex((s) => s.id === m.id && s.by === sender)
      if (i >= 0) {
        const s = strokes[i]
        if (s.endAt !== null || s.pts.length >= MAX_STROKE_NUMS) return strokes
        const next = strokes.slice()
        next[i] = { ...s, pts: s.pts.concat(m.pts).slice(0, MAX_STROKE_NUMS) }
        return next
      }
      const add: Stroke = { id: m.id, by: sender, tool: m.tool, color: m.color, pts: m.pts.slice(0, MAX_STROKE_NUMS), endAt: null }
      return [...strokes, add].slice(-MAX_STROKES)
    }
    case 'end': {
      const i = strokes.findIndex((s) => s.id === m.id && s.by === sender)
      if (i < 0 || strokes[i].endAt !== null) return strokes
      const next = strokes.slice()
      next[i] = { ...strokes[i], endAt: now }
      return next
    }
    case 'undo': {
      // Undo removes only the sender's own last stroke (the laser pointer fades on its own, not counted)
      for (let i = strokes.length - 1; i >= 0; i--) if (strokes[i].by === sender && strokes[i].tool === 'pen') return strokes.filter((_, j) => j !== i)
      return strokes
    }
    case 'clear': return strokes.length ? [] : strokes
    case 'sync': {
      const got = m.strokes.map((s) => ({ ...s, endAt: now }))
      const base = m.reset ? [] : strokes
      const ids = new Set(got.map((s) => `${s.by}|${s.id}`))
      return [...base.filter((s) => !ids.has(`${s.by}|${s.id}`)), ...got].slice(-MAX_STROKES)
    }
  }
}

/** Drop fully-faded laser pointers; returns the original array when nothing changed */
export function pruneLaser(strokes: Stroke[], now: number): Stroke[] {
  const keep = strokes.filter((s) => !(s.tool === 'laser' && s.endAt !== null && now - s.endAt > LASER_FADE_MS))
  return keep.length === strokes.length ? strokes : keep
}

/** Laser pointer's current opacity: 1 before pen-up, linear down to 0 within LASER_FADE_MS after */
export function laserAlpha(s: Stroke, now: number): number {
  if (s.endAt === null) return 1
  return Math.max(0, 1 - (now - s.endAt) / LASER_FADE_MS)
}

const byteLen = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length
/** Replay existing strokes for late joiners: pen strokes only (laser fades in seconds), chunked by the per-message cap; the first chunk carries reset so the peer clears first */
export function chunkSync(strokes: Stroke[], limit = SYNC_CHUNK_BYTES): AnnMsg[] {
  const pens: SyncStroke[] = strokes.filter((s) => s.tool === 'pen' && s.pts.length >= 2).map(({ id, by, tool, color, pts }) => ({ id, by, tool, color, pts }))
  if (!pens.length) return [{ t: 'ann', k: 'sync', reset: true, strokes: [] }]
  const out: AnnMsg[] = []
  let cur: SyncStroke[] = []
  const flush = () => { out.push({ t: 'ann', k: 'sync', reset: out.length === 0, strokes: cur }); cur = [] }
  for (const s of pens) {
    if (cur.length && byteLen({ t: 'ann', k: 'sync', reset: false, strokes: [...cur, s] }) > limit) flush()
    cur.push(s)
  }
  if (cur.length) flush()
  return out
}

/** Decimate: drop points too close to the previous one (normalized distance), reducing message volume */
export function farEnough(last: [number, number] | null, p: [number, number], min = 0.002): boolean {
  if (!last) return true
  return Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= min
}

/** New stroke id (unique per sender is enough) */
export function strokeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}
