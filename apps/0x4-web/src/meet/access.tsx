// 新建会议的「密码」「等候室」「在大厅公开」三个选项（等候室 2026-10-01），和大厅「正在进行的会议」列表的数据（2026-09-30 goat）。
// 网页版流媒体页（desktop/pages/Streaming.tsx）和手机流媒体页（pages/Live.tsx）共用，样式由调用方传进来。
import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import type { ActiveMeeting } from './links'

export const MEET_PW_MIN = 4
export const MEET_PW_MAX = 32

export interface MeetAccess { pwOn: boolean; pw: string; listed: boolean; lobby: boolean }
/** 默认（2026-10-01 晚 goat）：公开会议开、申请进入关、不设密码 =「开一个普通会议，别人在广场上看见就能点进来听」 */
export const DEFAULT_ACCESS: MeetAccess = { pwOn: false, pw: '', listed: true, lobby: false }
/** 表单能不能提交：开了密码就要 4~32 位 */
export const accessOk = (a: MeetAccess) => !a.pwOn || (a.pw.length >= MEET_PW_MIN && a.pw.length <= MEET_PW_MAX)
/** 发给服务器的字段 */
export const accessBody = (a: MeetAccess) => ({ listed: a.listed, lobby: a.lobby, ...(a.pwOn ? { password: a.pw } : {}) })

/** 三个开关（顺序 2026-10-01 goat：申请进入、设置密码、公开会议）+ 密码框。inputWrap：调用方的输入框样式（网页版 / 手机不同） */
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

/** 大厅「正在进行的会议」（公开接口，免登录），20 秒刷新；页面在后台时不拉 */
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

/** 有密码的会议在列表里的锁标记 */
export const LockBadge = () => <span className="inline-flex items-center gap-1 rounded-full bg-white/[.08] px-2 py-0.5 text-[11px] text-muted"><Lock size={11} />{t('需要密码')}</span>
