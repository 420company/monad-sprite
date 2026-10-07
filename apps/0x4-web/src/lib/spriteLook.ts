// Have your sprite look at a chart (2026-10-02 goat, batch 3): POST /api/flies/:id/look?stream=1, the server narrates while pushing (SSE).
// Read-only answers — never sends any trading requests.
import { SOCIAL_API, getToken } from './social'
import { translateServerError } from './sysText'
import type { ChartBrief } from './chartBrief'

export interface LookReply { text: string; textEn: string; ts?: number }

/** Split received text chunks into SSE events: returns the parsed events and the not-yet-complete tail */
export function parseSse(buf: string): { events: Record<string, unknown>[]; rest: string } {
  const parts = buf.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: Record<string, unknown>[] = []
  for (const p of parts) {
    const line = p.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try { const ev = JSON.parse(line.slice(6)) as unknown; if (ev && typeof ev === 'object') events.push(ev as Record<string, unknown>) } catch { /* Partial chunks don't count */ }
  }
  return { events, rest }
}

/**
 * Ask once. onDelta: fires as it speaks (the full Chinese / English text spoken so far, not a delta).
 * Failures throw with copy already translated to the UI language; status is the HTTP code (429 = asked too often, 409 = dormant, 503 = no response)
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
  // Not a stream (old server / proxy buffered the stream into one chunk): read as plain JSON
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
