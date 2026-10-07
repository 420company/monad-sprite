// 通知震动（2026-09-29 goat：「震动最好做细点，可以在通知里也能设置哪些通知可以有震动，用户自己选开关」）。
//
// 管的是 App 开着的时候（前台）收到提醒要不要震：私信、群里 @ 我、群聊新消息、评论、礼物和红包、新粉丝、
// 小精灵（交易确认请求、成交、停机提醒）、官方公告、其他通知。每类一个开关，存在本机（useSettings.notifyHaptics）。
// App 在后台时手机上弹的推送，声音和震动由手机系统设置决定，这里不管。
//
// 震动手感用系统的「提醒」震动（UINotificationFeedbackGenerator warning），和点按时的轻震、操作成功 / 失败的震动都不一样，
// 一摸就知道是来了新消息。同一时间段收到一串（群里刷屏、私信和它的通知一起到）只震一次。
import { isNative, hapticNotice, setResultHapticsGate } from '@/lib/native'
import { useSettings } from '@/store/settings'

// 操作成功 / 失败的震动跟「按键震动」一个开关（2026-09-29 goat 合并）。本模块由社交 store 在启动时加载，接上后全 App 生效
setResultHapticsGate(() => useSettings.getState().pressHaptics !== false)

export type VibeKind = 'dm' | 'mention' | 'group' | 'comment' | 'gift' | 'follow' | 'like' | 'fly' | 'official' | 'other'

/**
 * 默认值：和自己直接相关、需要尽快处理的默认开（私信、@ 我、小精灵要你确认的交易、礼物红包、评论、官方公告、其他系统提醒）；
 * 群聊普通消息量大，默认关；新粉丝、点赞不急，默认关，和推送的默认值一致。
 */
export const VIBE_DEFAULTS: Record<VibeKind, boolean> = {
  dm: true, mention: true, group: false, comment: true, gift: true, follow: false, like: false, fly: true, official: true, other: true,
}

/** 设置页的顺序和文字（文字存简体原文，显示时 t() 翻译） */
export const VIBE_ROWS: [VibeKind, string][] = [
  ['dm', '私信'], ['mention', '群里 @ 我'], ['group', '群聊新消息'], ['fly', '小精灵'], ['comment', '评论'],
  ['gift', '礼物和红包'], ['follow', '新粉丝'], ['like', '点赞'], ['official', '官方公告'], ['other', '其他通知'],
]

/**
 * 这一类 App 开着时震不震（2026-09-29 goat：通知和震动合成一个开关，开通知 = 声音和震动都有）：
 * 本机单独存过就用存的（老版本里单独关过震动的类别保留他的选择，再动一次这个开关就和通知对齐）；
 * 没存过就跟这一类的推送开关走；推送开关也还没拉到过就用默认值
 */
export function vibeOn(kind: VibeKind): boolean {
  const s = useSettings.getState()
  const saved = s.notifyHaptics?.[kind]
  if (typeof saved === 'boolean') return saved
  const push = s.pushPrefsCache?.[kind]
  return typeof push === 'boolean' ? push : VIBE_DEFAULTS[kind]
}

/** 站内通知的类型 → 震动类别。小精灵发来的系统通知带 fly: 开头的链接 */
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

/** 一串提醒挤在一起时只震一次 */
export const NOTICE_GAP_MS = 1500
let lastNoticeAt = -Infinity

/** 前台收到一条提醒：这一类开着、App 在前台，才震 */
export function notifyHaptic(kind: VibeKind): void {
  if (!isNative) return
  if (typeof document !== 'undefined' && document.hidden) return   // 在后台：交给系统推送
  if (!vibeOn(kind)) return
  const now = Date.now()
  if (now - lastNoticeAt < NOTICE_GAP_MS) return
  lastNoticeAt = now
  hapticNotice()
}

/** 测试用 */
export function resetNoticeThrottle() { lastNoticeAt = -Infinity }
