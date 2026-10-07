// 会议码 / 邀请链接 / 会议数据的类型：单独放一个小文件，直播页引用它时不会把整个会议室（含音视频库）打进首屏包。
import { SHARE_BASE } from '@/live/share'

export interface Meeting { id: string; host: string; hostNickname: string | null; hostAvatar: string | null; title: string; createdAt: number; endedAt: number | null; lastAt: number | null; /** 有没有密码（2026-09-30）：有的话除主持人外进会要输对 */ hasPassword?: boolean; listed?: boolean; /** 开了等候室（2026-10-01）：除主持人和管理员外进会要等同意 */ lobby?: boolean }
/** 大厅「正在进行的会议」一行（GET /api/meet/meetings/active） */
export interface ActiveMeeting {
  id: string; title: string; host: string; hostNickname: string | null; hostAvatar: string | null; participants: number; hasPassword: boolean
  /** 2026-10-01：要不要申请进入、这一场开始的时间、前几位参会人（主持人在前） */
  lobby?: boolean; since?: number | null; people?: { address: string; nickname: string | null; avatar: string | null }[]
}
/** 会议码：abc-defg-hij */
export const MEET_CODE = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i
/** 邀请链接（2026-10-02 goat：要短一点）：420.meme/m/会议码。站点把 /m/:id 转给服务器的会议分享页（带聊天软件预览卡片），
 *  点开后已登录直接进会议、没登录先登录（pages/Watch.tsx）。老格式 网页版/#/meet/会议码 和 /meet/会议码 照样能用 */
export const meetLink = (code: string) => `${SHARE_BASE}/m/${code}`
