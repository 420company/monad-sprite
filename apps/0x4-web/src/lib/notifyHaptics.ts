// Notification haptics (2026-09-29 goat: "make vibration granular — let users pick which notifications may buzz, their own toggles").
//
// Covers whether foreground (app open) alerts buzz: DMs, group @-mentions, group messages, comments, gifts and red packets, new followers,
// fly sprites (trade confirm requests, fills, downtime alerts), official announcements, other notifications. One toggle per category, stored locally (useSettings.notifyHaptics).
// Background push notifications on phones: sound and vibration follow the OS settings, not managed here.
//
// The buzz uses the system's "notification" haptic (UINotificationFeedbackGenerator warning) — distinct from tap ticks and success/failure buzzes,
// so one touch tells you a new message arrived. A burst in the same window (group spam, a DM plus its notification) buzzes only once.
import { isNative, hapticNotice, setResultHapticsGate } from '@/lib/native'
import { useSettings } from '@/store/settings'

// Success/failure buzzes share the "key haptics" toggle (merged by goat 2026-09-29). Loaded at startup by the social store; app-wide once wired
setResultHapticsGate(() => useSettings.getState().pressHaptics !== false)

export type VibeKind = 'dm' | 'mention' | 'group' | 'comment' | 'gift' | 'follow' | 'like' | 'fly' | 'official' | 'other'

/**
 * Defaults: categories directly about me that need prompt action default on (DMs, @-mentions, trade confirms
 * from sprites, gift red packets, comments, official announcements, other system alerts); group chatter is
 * high-volume — default off; new followers and likes aren't urgent — default off, matching push defaults.
 */
export const VIBE_DEFAULTS: Record<VibeKind, boolean> = {
  dm: true, mention: true, group: false, comment: true, gift: true, follow: false, like: false, fly: true, official: true, other: true,
}

/** Settings-page order and labels (labels stored as Simplified source, t()-translated at display) */
export const VIBE_ROWS: [VibeKind, string][] = [
  ['dm', '私信'], ['mention', '群里 @ 我'], ['group', '群聊新消息'], ['fly', '小精灵'], ['comment', '评论'],
  ['gift', '礼物和红包'], ['follow', '新粉丝'], ['like', '点赞'], ['official', '官方公告'], ['other', '其他通知'],
]

/**
 * Whether this category buzzes while the app is open (2026-09-29 goat: notification and haptics merged into
 * one toggle — notifications on = sound and buzz):
 * a locally stored choice wins (categories whose buzz was toggled off individually in old versions keep the
 * user's choice; touching the toggle again aligns it with notifications);
 * otherwise follow this category's push toggle; fall back to defaults when the push toggle was never fetched
 */
export function vibeOn(kind: VibeKind): boolean {
  const s = useSettings.getState()
  const saved = s.notifyHaptics?.[kind]
  if (typeof saved === 'boolean') return saved
  const push = s.pushPrefsCache?.[kind]
  return typeof push === 'boolean' ? push : VIBE_DEFAULTS[kind]
}

/** In-app notification type → haptic category. System notifications from sprites carry fly:-prefixed links */
export function vibeKindOfNotif(type: string, ref?: string | null): VibeKind {
  switch (type) {
    case 'dm': return 'dm'
    case 'mention': return 'mention'
    case 'comment': return 'comment'
    case 'gift': case 'packet': return 'gift'
    case 'follow': case 'friend': return 'follow'
    case 'like': return 'like'
    default: return typeof ref === 'string' && ref.startsWith('fly:') ? 'fly' : 'other'
  }
}

/** One buzz for a clustered burst of alerts */
export const NOTICE_GAP_MS = 1500
let lastNoticeAt = -Infinity

/** A foreground alert buzzes only when its category is on and the app is foregrounded */
export function notifyHaptic(kind: VibeKind): void {
  if (!isNative) return
  if (typeof document !== 'undefined' && document.hidden) return   // In background: handed to system push
  if (!vibeOn(kind)) return
  const now = Date.now()
  if (now - lastNoticeAt < NOTICE_GAP_MS) return
  lastNoticeAt = now
  hapticNotice()
}

/** Test only */
export function resetNoticeThrottle() { lastNoticeAt = -Infinity }
