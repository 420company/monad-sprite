// 会议里的画笔标注（2026-09-30 goat：讲课的人在我们会议页面上标出重点，不是在被共享的软件里画）。
// 这里只放纯逻辑（坐标换算、消息校验、笔画状态），画布和工具条在 AnnotationLayer.tsx，同步走会议已有的数据通道（lk.ts packData）。
//
// 规则：
//   · 谁能画：当前正在共享屏幕的人、会议主持人。收到消息时按音视频服务给的发送者身份（participant.identity）判断，不信消息里自报的。
//   · 坐标按共享画面「实际显示的内容区域」归一化到 0..1（画面是 object-fit: contain，四周可能有黑边），
//     所以不同窗口大小的人看到的标注落在画面上同一个位置。
//   · 画的过程中每 ~50ms 发一段增量（seg），抬笔发 end；撤销（undo）只撤发送者自己最后一笔；清除（clear）清全部。
//   · 新进来的人：共享者把现有笔画（不含激光笔）补发一次（sync，分段，每段不超过数据通道单条上限）。
//   · 停止共享 / 换人共享：所有人本地清空，不用发消息。

export type AnnTool = 'pen' | 'laser'
export type AnnColor = 'red' | 'yellow' | 'green'
export const ANN_COLORS: Record<AnnColor, string> = { red: '#ff4d5e', yellow: '#ffd23f', green: '#3ddc84' }
/** 激光笔抬笔后多久淡出消失 */
export const LASER_FADE_MS = 3000
/** 一笔最多多少个数（x、y 各算一个）：600 个点，正常画一个圈几十到一两百个点 */
export const MAX_STROKE_NUMS = 1200
/** 同一时间最多保留多少笔（多了丢最早的） */
export const MAX_STROKES = 300
/** 数据通道单条消息的安全上限（字节），补发时按这个分段 */
export const SYNC_CHUNK_BYTES = 12_000

export interface Stroke { id: string; by: string; tool: AnnTool; color: AnnColor; pts: number[]; endAt: number | null }
export type SyncStroke = Pick<Stroke, 'id' | 'by' | 'tool' | 'color' | 'pts'>
export type AnnMsg =
  | { t: 'ann'; k: 'seg'; id: string; tool: AnnTool; color: AnnColor; pts: number[] }
  | { t: 'ann'; k: 'end'; id: string }
  | { t: 'ann'; k: 'undo' }
  | { t: 'ann'; k: 'clear' }
  | { t: 'ann'; k: 'sync'; reset: boolean; strokes: SyncStroke[] }

/** 能不能画：发送者是当前共享屏幕的人，或者是主持人 */
export function canAnnotate(identity: string | undefined | null, sharerId: string | null | undefined, hostId: string | null | undefined): boolean {
  if (!identity) return false
  return (!!sharerId && identity === sharerId) || (!!hostId && identity === hostId)
}

// ---------- 坐标 ----------
export interface Rect { x: number; y: number; w: number; h: number }
/** object-fit: contain 时视频内容在容器里实际占的区域（容器坐标）。还不知道视频尺寸时按整个容器算 */
export function contentRect(cw: number, ch: number, vw: number, vh: number): Rect {
  if (!(cw > 0 && ch > 0)) return { x: 0, y: 0, w: 0, h: 0 }
  if (!(vw > 0 && vh > 0)) return { x: 0, y: 0, w: cw, h: ch }
  const s = Math.min(cw / vw, ch / vh)
  const w = vw * s, h = vh * s
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
}
const q4 = (n: number) => Math.round(n * 10000) / 10000
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)
/** 容器坐标 → 归一化（0..1，保留 4 位小数，超出内容区域的夹到边上） */
export function toNorm(px: number, py: number, r: Rect): [number, number] {
  if (!(r.w > 0 && r.h > 0)) return [0, 0]
  return [q4(clamp01((px - r.x) / r.w)), q4(clamp01((py - r.y) / r.h))]
}
/** 归一化 → 容器坐标 */
export function fromNorm(nx: number, ny: number, r: Rect): [number, number] {
  return [r.x + nx * r.w, r.y + ny * r.h]
}

// ---------- 消息校验 ----------
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/
const isTool = (x: unknown): x is AnnTool => x === 'pen' || x === 'laser'
const isColor = (x: unknown): x is AnnColor => x === 'red' || x === 'yellow' || x === 'green'
function cleanPts(x: unknown, max: number): number[] | null {
  if (!Array.isArray(x) || x.length % 2 !== 0 || x.length > max) return null
  for (const n of x) if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return null
  return x as number[]
}
/** 收到的数据消息是不是合法的标注消息；不合法返回 null（形状不对、坐标越界、点太多一律丢掉） */
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

// ---------- 状态 ----------
/** 按一条消息更新笔画（sender = 音视频服务给的发送者身份）。纯函数，返回新数组 */
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
      // 只撤发送者自己最后一笔（激光笔会自己消失，不算）
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

/** 去掉已经淡出完的激光笔；没有变化返回原数组 */
export function pruneLaser(strokes: Stroke[], now: number): Stroke[] {
  const keep = strokes.filter((s) => !(s.tool === 'laser' && s.endAt !== null && now - s.endAt > LASER_FADE_MS))
  return keep.length === strokes.length ? strokes : keep
}

/** 激光笔现在的透明度：没抬笔 1，抬笔后 LASER_FADE_MS 内线性降到 0 */
export function laserAlpha(s: Stroke, now: number): number {
  if (s.endAt === null) return 1
  return Math.max(0, 1 - (now - s.endAt) / LASER_FADE_MS)
}

const byteLen = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length
/** 给新进来的人补发现有笔画：只补画笔（激光笔几秒就没了），按单条上限分段；第一段带 reset 让对方先清空 */
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

/** 抽稀：离上一个点太近的不要（归一化距离），减少消息量 */
export function farEnough(last: [number, number] | null, p: [number, number], min = 0.002): boolean {
  if (!last) return true
  return Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= min
}

/** 新笔画的编号（只要同一个人不重复） */
export function strokeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}
