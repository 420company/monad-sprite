// Shared computers signed in via QR ("this session only" picked on the phone): auto-logout after long idleness (2026-10-01 goat: people forget to log out after scanning at internet cafés / office PCs).
// "Trust this device" computers don't go through here (login lasts 30 days, never expires from inactivity). Extension / wallet logins don't either.
// The server judges by "last active" (server/src/auth.ts WEB_QR_*): a popup after 30 idle minutes, 2 more minutes grace, expired at 32 minutes. This side handles:
//   1. Tell the server "still here" only when genuinely active, at most once a minute — not a timer. What counts (the server only recognizes these too):
//      input = clicks, keys, wheel, touch; speak = talking in a meeting / live stream (only LiveKit's "speaking" flag — no recording, no upload);
//      chat = sending messages; gift = sending gifts. Just having the page open watching / listening doesn't count.
//   2. After 30 minutes without these, pop the idle-timeout prompt; auto-logout if unanswered within 2 minutes.
import { api } from '@/lib/social'

/** Idle time before the popup */
export const IDLE_MS = 30 * 60_000
/** Grace period after the popup before auto-logout */
export const GRACE_MS = 2 * 60_000
/** Minimum interval between two "still here" reports */
export const PING_GAP_MS = 60_000
/** Input events counting as "genuinely operating" (mouse move excluded: bumping the desk doesn't mean someone's there) */
export const ACTIVE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
/** Activity kinds counting as "in use" (matches the server's WEB_ACTIVE_KINDS) */
export type ActivityKind = 'input' | 'speak' | 'chat' | 'gift'

export type IdleStage = 'ok' | 'warn' | 'out'
/** Time since last activity: fine / should warn / should log out */
export function idleStage(now: number, lastActive: number, idleMs = IDLE_MS, graceMs = GRACE_MS): IdleStage {
  const idle = now - lastActive
  if (idle >= idleMs + graceMs) return 'out'
  if (idle >= idleMs) return 'warn'
  return 'ok'
}
/** Whether to report this activity to the server (only if over a minute since the last report) */
export const shouldPing = (now: number, lastPing: number, gap = PING_GAP_MS) => now - lastPing >= gap

/** Tell the server "still here" with the activity kind; when the session is already dead the server returns 401 and api() routes through the unified "login expired" handling */
export const pingActive = (token: string, kind: ActivityKind = 'input') =>
  api<{ ok: true; expiresAt?: number | null }>('/api/auth/web-active', { method: 'POST', body: JSON.stringify({ kind }) }, { token })

export interface IdleWatcher { stop: () => void; touch: (kind?: ActivityKind) => void }

// The one the current page is watching (meeting, live, chat, and gift panels call reportActivity directly — no threading through layers)
let current: IdleWatcher | null = null
/** Something counting as "in use" happened on the page: talking, message sent, gift sent. Does nothing when there's no QR login (nothing being watched) */
export function reportActivity(kind: ActivityKind) { current?.touch(kind) }

/**
 * Watches this page's activity. onStage fires on stage changes (warn = popup, out = logout).
 * Timing checks "time since last activity" every 15 s instead of one 30-minute timer (long timers go wrong after the machine sleeps and wakes).
 * ★ Once the popup shows, only clicking "keep using" (or calling touch) renews; other inputs during the popup don't count (otherwise a mouse bump would dismiss it while the person is already gone).
 */
export function watchIdle(opts: { onStage: (s: IdleStage) => void; ping: (kind: ActivityKind) => Promise<unknown>; now?: () => number; target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>; tickMs?: number }): IdleWatcher {
  const now = opts.now ?? Date.now
  const target = opts.target ?? window
  let lastActive = now(), lastPing = now(), stage: IdleStage = 'ok', stopped = false
  const set = (s: IdleStage) => { if (s !== stage) { stage = s; opts.onStage(s) } }
  const touch = (kind: ActivityKind = 'input') => {
    if (stopped || stage === 'out') return
    const t = now()
    lastActive = t
    set('ok')
    if (shouldPing(t, lastPing)) { lastPing = t; void opts.ping(kind).catch(() => { /* 401s log out via the unified handler; network errors are reported on the next activity */ }) }
  }
  // Real operations on the page: not counted once the popup shows (the button must be clicked)
  const onInput = () => { if (stage === 'ok') touch('input') }
  const tick = () => { if (!stopped) set(idleStage(now(), lastActive)) }
  for (const e of ACTIVE_EVENTS) target.addEventListener(e, onInput, { passive: true, capture: true } as AddEventListenerOptions)
  const timer = setInterval(tick, opts.tickMs ?? 15_000)
  const w: IdleWatcher = {
    touch,
    stop: () => {
      stopped = true
      clearInterval(timer)
      for (const e of ACTIVE_EVENTS) target.removeEventListener(e, onInput, { capture: true } as EventListenerOptions)
      if (current === w) current = null
    },
  }
  current = w
  return w
}
