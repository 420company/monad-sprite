// Community → Meetings (/meetings, 2026-10-01 community merge, mock "3-community-meetings" + goat's changes that evening):
//   top bar: paste meeting link or enter meeting code · join · new meeting (the three switches — request-to-join / set password / public meeting — live in the "New meeting" dialog,
//            goat: "these are options for creating a meeting, they shouldn't appear in the join-meeting spot"; defaults: public on, request-to-join off, no password);
//   ongoing meetings: public meetings — name, ongoing for N minutes, request-to-join / password-required badges, host, online count, attendee avatars and names, button on the right;
//   meeting history: meetings I started and joined (after login).
// Data: /api/meet/meetings/active (public), /api/meet/meetings/mine (login required), POST /api/meet/meetings.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Link2, Lock, Plus, Video } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { timeAgo } from '@/lib/format'
import { t } from '@/lib/i18n'
import { copyText } from '@/lib/native'
import { useSocial, displayName } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { MEET_CODE, meetLink, type ActiveMeeting, type Meeting } from '@/meet/links'
import { useActiveMeetings } from '@/meet/access'
import { needLogin } from '../walletGate'
import { SocialLogin } from '../ui'
import CommunityShell from './CommunityShell'
import { StreamHead } from './StreamHead'
import NewMeetingSheet from './NewMeetingSheet'

export default function MeetingsView() {
  return <CommunityShell><MeetingsBody /></CommunityShell>
}

function MeetingsBody() {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const appLogin = useSocial((s) => s.qrMode && s.status === 'ready')
  const connected = useWallet(isWalletConnected) || appLogin
  const ready = status === 'ready'
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const { list, failed } = useActiveMeetings()
  const parsed = MEET_CODE.exec(code.trim())?.[1]?.toLowerCase()
  return (
    <>
      <StreamHead mode="meet" sub={t('拉上朋友开个视频会，发个链接就能进来')} />
      <SocialLogin bar />
      <form className="cm-meetbar" onSubmit={(e) => { e.preventDefault(); if (parsed && !needLogin()) nav(`/meet/${parsed}`) }}>
        <label><Link2 size={17} aria-hidden="true" /><input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('粘贴会议链接或输入会议码')} spellCheck={false} aria-label={t('会议码')} /></label>
        <button type="submit" className="cm-btn is-quiet" disabled={!parsed}>{t('加入')}</button>
        <button type="button" className="cm-btn" onClick={() => { if (!needLogin()) setCreating(true) }} disabled={connected && !ready}><Plus size={17} />{t('新建会议')}</button>
      </form>

      <div className="cm-sec-h">
        <h3>{showHistory ? t('会议历史记录') : t('正在进行的会议')}</h3>
        <button type="button" className="cm-link" onClick={() => { if (!showHistory && needLogin()) return; setShowHistory(!showHistory) }}>{showHistory ? t('正在进行的会议') : t('会议历史记录')}</button>
      </div>
      {showHistory ? <History ready={ready} /> : (
        failed && !list ? <div className="cm-empty">{t('暂时无法加载会议列表')}</div>
          : !list ? <div className="flex flex-col gap-3 pt-3">{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 64 }} />)}</div>
            : !list.length ? <div className="cm-empty"><Video size={26} aria-hidden="true" /><span>{t('现在没有公开的会议。新建一个，打开「公开会议」，大家就能在这里看到。')}</span></div>
              : <div>{list.map((m) => <ActiveRow key={m.id} m={m} onJoin={() => { if (!needLogin()) nav(`/meet/${m.id}`) }} />)}</div>
      )}

      <NewMeetingSheet open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

/** How long it's been going: "ongoing for 18 minutes"; under a minute says "just started" */
function since(ms: number | null | undefined): string | null {
  if (!ms) return null
  const m = Math.floor((Date.now() - ms) / 60_000)
  return m < 1 ? t('刚开始') : m < 60 ? t('进行中 {n} 分钟', { n: m }) : t('进行中 {h} 小时 {m} 分钟', { h: Math.floor(m / 60), m: m % 60 })
}

/** One ongoing-meeting row: password required → enter password; approval required → request to join; neither → join */
function ActiveRow({ m, onJoin }: { m: ActiveMeeting; onJoin: () => void }) {
  const host = displayName({ address: m.host, nickname: m.hostNickname })
  const people = m.people ?? []
  const names = people.filter((p) => p.address !== m.host).slice(0, 3).map((p) => displayName(p))
  const action = m.hasPassword ? t('输入密码') : m.lobby ? t('申请进入') : t('加入')
  const went = since(m.since)
  return (
    <div className="cm-mrow" data-testid="active-meeting">
      <Avatar address={m.host} src={m.hostAvatar} name={m.hostNickname} size={52} />
      <div className="cm-mrow-b">
        <div className="cm-mrow-t">
          <span>{m.title}</span>
          {went && <span className="cm-pill is-on">{went}</span>}
          {m.lobby && <span className="cm-pill">{t('申请进入')}</span>}
          {m.hasPassword && <span className="cm-pill"><Lock size={11} aria-hidden="true" />{t('要密码')}</span>}
        </div>
        <p className="cm-mrow-s">
          {t('主持 {name}', { name: host })}<span className="num">　{t('{n} 人在线', { n: m.participants })}</span>
          {names.length > 0 && <>　{t('{names} 也在', { names: names.join('、') })}</>}
        </p>
      </div>
      {people.length > 0 && <span className="cm-faces" aria-label={t('参会的人')}>{people.slice(0, 5).map((p) => <span key={p.address} title={displayName(p)}><Avatar address={p.address} src={p.avatar} name={p.nickname} size={30} /></span>)}</span>}
      <button type="button" className="cm-btn is-quiet" onClick={onJoin}>{action}</button>
    </div>
  )
}

/** Meeting history: started and joined by me (latest 30) */
function History({ ready }: { ready: boolean }) {
  const nav = useNavigate()
  const [list, setList] = useState<Meeting[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!ready) return
    let alive = true
    api<Meeting[]>('/api/meet/meetings/mine').then((l) => { if (alive) setList(Array.isArray(l) ? l : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [ready])
  const copy = (id: string) => copyText(meetLink(id)).then(() => toast.success(t('邀请链接已复制')), () => toast.error(t('复制失败')))
  if (!ready) return <div className="cm-empty"><SocialLogin row={false} /></div>
  if (failed && !list) return <div className="cm-empty">{t('暂时无法加载会议记录')}</div>
  if (!list) return <div className="flex flex-col gap-3 pt-3">{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 56 }} />)}</div>
  if (!list.length) return <div className="cm-empty"><Video size={26} aria-hidden="true" /><span>{t('还没有会议，新建一个把链接发给要参加的人。')}</span></div>
  return <div>{list.map((m) => (
    <div key={m.id} className="cm-mrow">
      <Avatar address={m.host} src={m.hostAvatar} name={m.hostNickname} size={40} />
      <div className="cm-mrow-b">
        <div className="cm-mrow-t"><span>{m.title}</span>{m.endedAt ? <span className="cm-pill">{t('已结束')}</span> : null}</div>
        <p className="cm-mrow-s num">{m.id} · {t('主持 {name}', { name: displayName({ address: m.host, nickname: m.hostNickname }) })} · {timeAgo(m.lastAt || m.createdAt)}</p>
      </div>
      <button type="button" className="cm-btn is-quiet is-sm" onClick={() => void copy(m.id)} aria-label={t('复制邀请链接')} title={t('复制邀请链接')}><Copy size={14} /></button>
      {!m.endedAt && <button type="button" className="cm-btn is-sm" onClick={() => nav(`/meet/${m.id}`)}>{t('加入')}</button>}
    </div>))}</div>
}
