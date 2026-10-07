// 让自己的小精灵看一眼图（2026-10-02 goat 第三批）：POST /api/flies/:id/look?stream=1，服务器边说边推（SSE）。
// 只读回答，不发任何交易请求。
import { SOCIAL_API, getToken } from './social'
import { translateServerError } from './sysText'
import type { ChartBrief } from './chartBrief'

export interface LookReply { text: string; textEn: string; ts?: number }

/** 把收到的一段段文字切成 SSE 事件：返回解析出来的事件和还没收完的尾巴 */
export function parseSse(buf: string): { events: Record<string, unknown>[]; rest: string } {
  const parts = buf.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: Record<string, unknown>[] = []
  for (const p of parts) {
    const line = p.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try { const ev = JSON.parse(line.slice(6)) as unknown; if (ev && typeof ev === 'object') events.push(ev as Record<string, unknown>) } catch { /* 半截的不算 */ }
  }
  return { events, rest }
}

/**
 * 问一次。onDelta：它说到哪儿回调到哪儿（当前已经说出来的中文 / 英文全文，不是增量）。
 * 失败抛错，文案已经按界面语言翻好；status 是 HTTP 状态码（429 = 问得太频繁，409 = 在休眠，503 = 没回应）
 */
export async function askSpriteLook(flyId: string, brief: ChartBrief, onDelta: (p: LookReply) => void, signal?: AbortSignal): Promise<LookReply> {
  const token = getToken()
  const res = await fetch(`${SOCIAL_API}/api/flies/${encodeURIComponent(flyId)}/look?stream=1`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ brief }),
  })
  const fail = (msg: unknown, status: number) => Object.assign(new Error(translateServerError(typeof msg === 'string' && msg ? msg : `HTTP ${status}`)), { status })
  if (!res.ok) { const body = await res.json().catch(() => ({})) as { error?: string }; throw fail(body.error, res.status) }
  const str = (v: unknown) => typeof v === 'string' ? v : ''
  const replyOf = (ev: Record<string, unknown>): LookReply | null => {
    const r = ev.reply as { text?: unknown; textEn?: unknown; ts?: unknown } | undefined
    return r && typeof r.text === 'string' ? { text: r.text, textEn: str(r.textEn) || r.text, ts: typeof r.ts === 'number' ? r.ts : undefined } : null
  }
  // 不是流（老服务器 / 代理把流攒成了一整块）：按普通 JSON 读
  if (!res.body || !/event-stream/.test(res.headers.get('content-type') || '')) {
    const r = replyOf(await res.json().catch(() => ({})) as Record<string, unknown>)
    if (!r) throw fail('它现在没有回应，稍后再试', 503)
    return r
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let done: LookReply | null = null
  for (;;) {
    const { value, done: end } = await reader.read()
    if (value) buf += dec.decode(value, { stream: true })
    const { events, rest } = parseSse(end ? buf + '\n\n' : buf)
    buf = rest
    for (const ev of events) {
      if (ev.type === 'delta') onDelta({ text: str(ev.text), textEn: str(ev.textEn) })
      else if (ev.type === 'done') done = replyOf(ev)
      else if (ev.type === 'error') throw fail(ev.error, typeof ev.status === 'number' ? ev.status : 503)
    }
    if (end) break
  }
  if (!done) throw fail('它现在没有回应，稍后再试', 503)
  return done
}
