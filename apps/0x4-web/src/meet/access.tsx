// The new-meeting "password" / "waiting room" / "list in lobby" options (waiting room 2026-10-01), and the lobby "ongoing meetings" list data (2026-09-30 goat).
// Shared by the web streaming page (desktop/pages/Streaming.tsx) and the mobile streaming page (pages/Live.tsx); styles come from the caller.
import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import type { ActiveMeeting } from './links'

export const MEET_PW_MIN = 4
export const MEET_PW_MAX = 32

export interface MeetAccess { pwOn: boolean; pw: string; listed: boolean; lobby: boolean }
/** Defaults (2026-10-01 evening goat): public meeting on, request-to-join off, no password = "open a normal meeting — anyone who sees it in the plaza can tap in and listen" */
export const DEFAULT_ACCESS: MeetAccess = { pwOn: false, pw: '', listed: true, lobby: false }
/** Whether the form can submit: a password must be 4–32 chars when enabled */
export const accessOk = (a: MeetAccess) => !a.pwOn || (a.pw.length >= MEET_PW_MIN && a.pw.length <= MEET_PW_MAX)
/** Fields sent to the server */
export const accessBody = (a: MeetAccess) => ({ listed: a.listed, lobby: a.lobby, ...(a.pwOn ? { password: a.pw } : {}) })

/** Three toggles (order 2026-10-01 goat: request-to-join, set password, public meeting) + password box. inputWrap: the caller's input styles (web / mobile differ) */
export function MeetAccessFields({ value, onChange, inputWrap }: { value: MeetAccess; onChange: (v: MeetAccess) => void; inputWrap: (input: React.ReactNode) => React.ReactNode }) {
  const set = (p: Partial<MeetAccess>) => onChange({ ...value, ...p })
  const short = value.pwOn && value.pw.length > 0 && value.pw.length < MEET_PW_MIN
  return <div className="flex flex-col gap-3">
    <Toggle on={value.lobby} onToggle={() => set({ lobby: !value.lobby })} title={t('申请进入')} desc={t('打开后，别人要等你同意才能进来')} testId="meet-lobby-toggle" />
    <Toggle on={value.pwOn} onToggle={() => set({ pwOn: !value.pwOn })} title={t('设置密码')} desc={t('开启后需要输入密码才能加入')} testId="meet-pw-toggle" />
    {value.pwOn && <div>
      {inputWrap(<input type="text" value={value.pw} onChange={(e) => set({ pw: e.target.value.slice(0, MEET_PW_MAX) })} placeholder={t('{min}~{max} 位密码', { min: MEET_PW_MIN, max: MEET_PW_MAX })} autoComplete="off" spellCheck={false} maxLength={MEET_PW_MAX} data-testid="meet-pw-input" />)}
      {short && <p className="mt-1.5 text-[12px] text-[#ff6b76]">{t('密码至少 {n} 位', { n: MEET_PW_MIN })}</p>}
    </div>}
    <Toggle on={value.listed} onToggle={() => set({ listed: !value.listed })} title={t('公开会议')} desc={t('出现在「正在进行的会议」里，大家看到就能点进来')} testId="meet-listed-toggle" />
  </div>
}

function Toggle({ on, onToggle, title, desc, testId }: { on: boolean; onToggle: () => void; title: string; desc: string; testId: string }) {
  return <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex w-full items-center gap-3 text-left" data-testid={testId}>
    <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-fg">{title}</span><span className="mt-0.5 block text-[12px] text-muted">{desc}</span></span>
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-white/15'}`} aria-hidden="true"><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span>
  </button>
}

/** Lobby "ongoing meetings" (public endpoint, no login), refreshed every 20 s; not fetched while the page is in the background */
export function useActiveMeetings(): { list: ActiveMeeting[] | null; failed: boolean } {
  const [list, setList] = useState<ActiveMeeting[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => api<ActiveMeeting[]>('/api/meet/meetings/active', {}, { anonymous: true })
      .then((l) => { if (alive) { setList(Array.isArray(l) ? l : []); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    void load()
    const id = setInterval(() => { if (!document.hidden) void load() }, 20_000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return { list, failed }
}

/** Lock badge for password-protected meetings in the list */
export const LockBadge = () => <span className="inline-flex items-center gap-1 rounded-full bg-white/[.08] px-2 py-0.5 text-[11px] text-muted"><Lock size={11} />{t('需要密码')}</span>
