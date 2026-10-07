// Types for meeting codes / invite links / meeting data: kept in a small standalone file so the livestream page referencing it doesn't pull the whole meeting room (incl. the A/V lib) into the first-screen bundle.
import { SHARE_BASE } from '@/live/share'

export interface Meeting { id: string; host: string; hostNickname: string | null; hostAvatar: string | null; title: string; createdAt: number; endedAt: number | null; lastAt: number | null; /** Has a password (2026-09-30): if set, everyone but the host must enter it correctly to join */ hasPassword?: boolean; listed?: boolean; /** Lobby on (2026-10-01): everyone but the host and admins waits for approval to join */ lobby?: boolean }
/** One "ongoing meetings" lobby row (GET /api/meet/meetings/active) */
export interface ActiveMeeting {
  id: string; title: string; host: string; hostNickname: string | null; hostAvatar: string | null; participants: number; hasPassword: boolean
  /** 2026-10-01: whether approval is needed, when this meeting started, the first few attendees (host first) */
  lobby?: boolean; since?: number | null; people?: { address: string; nickname: string | null; avatar: string | null }[]
}
/** Meeting code: abc-defg-hij */
export const MEET_CODE = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i
/** Invite link (2026-10-02 goat: make it shorter): 420.meme/m/<meeting code>. The site routes /m/:id to the server's meeting share page (with chat-app preview cards),
 * opening it joins directly when logged in, asks for login first when not (pages/Watch.tsx). Old formats web/#/meet/<code> and /meet/<code> still work */
export const meetLink = (code: string) => `${SHARE_BASE}/m/${code}`
