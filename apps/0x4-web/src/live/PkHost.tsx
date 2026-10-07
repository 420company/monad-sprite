// The streamer's PK actions (set by goat 2026-09-30): random match / invite live streamers / who can invite me;
// Accept or decline an invite within 10 seconds; ending mid-match counts as a loss; on a draw or the end screen: "Rematch" (only starts when both sides tap), "End call";
// On a win, pop "matching the next opponent in 5 seconds" (auto-starts, cancellable); on a loss, offer "find another".
import { useEffect, useState } from 'react'
import { LoaderCircle, Shuffle, Swords, UserPlus, X } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import Avatar from '@/components/Avatar'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { t, locale } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { displayName } from '@/store/social'
import { LevelBadge, StreakBadge } from './Badges'
import { mmss, useTicker, type usePk } from './pk'

type Pk = ReturnType<typeof usePk>
interface Candidate { room: string; host: string; title: string; nickname: string; avatar: string | null; viewers: number; streak: number; level: number; policy: string }
type Policy = 'all' | 'mutual' | 'off'

export function PkHostSheet({ open, onClose, pk }: { open: boolean; onClose: () => void; pk: Pk }) {
  const [list, setList] = useState<Candidate[] | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [invited, setInvited] = useState<string | null>(null)
  useTicker(open && pk.queue.state === 'queued', 1000)
  useEffect(() => {
    if (!open) return
    let alive = true
    setList(null)
    api<Candidate[]>('/api/live/pk/candidates').then((l) => { if (alive) setList(l) }).catch(() => { if (alive) setList([]) })
    api<{ invites: Policy }>('/api/live/pk/prefs').then((p) => { if (alive) setPolicy(p.invites) }).catch(() => {})
    return () => { alive = false }
  }, [open])
  // Close once the match starts
  useEffect(() => { if (pk.pk?.phase === 'running') onClose() }, [pk.pk?.phase]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = pk.inviteState
    if (!s || !invited) return
    if (s.state === 'declined') toast.error(t('对方拒绝了 PK 邀请'))
    if (s.state === 'timeout') toast.error(t('对方没有回应'))
    if (s.state !== 'sent') setInvited(null)
  }, [pk.inviteState]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pk.error && open) { toast.error(t(pk.error.text)); setInvited(null) } }, [pk.error]) // eslint-disable-line react-hooks/exhaustive-deps
  const savePolicy = async (p: Policy) => {
    const prev = policy
    setPolicy(p)
    try { await api('/api/live/pk/prefs', { method: 'PUT', body: JSON.stringify({ invites: p }) }) } catch (e) { setPolicy(prev); toast.error(errorText(e, t('保存失败'))) }
  }
  const queued = pk.queue.state === 'queued'
  const waited = pk.queue.state === 'queued' ? Date.now() - pk.queue.since : 0
  return <Sheet open={open} onClose={onClose} title={t('主播 PK')}>
    <div className="space-y-6">
      <section>
        <p className="text-sm text-muted">{t('一局 4 分 20 秒，收到的礼物越多分越高。')}</p>
        <Button size="lg" className="mt-4 w-full" variant={queued ? 'secondary' : 'primary'} onClick={() => (queued ? pk.cancelQueue() : pk.queueUp(locale()))} data-testid="pk-random">
          {queued ? <><LoaderCircle size={18} className="animate-spin" />{t('正在匹配 · {s}', { s: mmss(waited) })} · {t('取消')}</> : <><Shuffle size={18} />{t('随机匹配')}</>}
        </Button>
      </section>
      <section>
        <h3 className="text-sm font-semibold">{t('邀请正在直播的主播')}</h3>
        {!list ? <div className="skeleton mt-3 h-14" /> : !list.length ? <p className="py-4 text-sm text-muted">{t('现在没有可以邀请的主播')}</p>
          : <div className="mt-2 divide-y divide-line/60">{list.map((c) => <div key={c.room} className="flex items-center gap-3 py-3">
            <Avatar address={c.host} src={c.avatar} name={c.nickname} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1 text-[15px] font-medium"><span className="truncate">{displayName({ address: c.host, nickname: c.nickname })}</span><LevelBadge level={c.level} role="streamer" size={16} /><StreakBadge n={c.streak} size={14} /></div>
              <div className="truncate text-xs text-muted">{c.title} · {t('{n} 人在看', { n: c.viewers })}</div>
            </div>
            <Button size="sm" variant="secondary" disabled={!!invited} loading={invited === c.host} onClick={() => { setInvited(c.host); pk.inviteHost(c.host) }}><UserPlus size={15} />{t('邀请')}</Button>
          </div>)}</div>}
      </section>
      <section>
        <h3 className="text-sm font-semibold">{t('谁可以邀请我 PK')}</h3>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-card2 p-1" role="radiogroup" aria-label={t('谁可以邀请我 PK')}>
          {([['all', '所有人'], ['mutual', '互相关注的人'], ['off', '不接收']] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={policy === v} disabled={!policy} onClick={() => void savePolicy(v)} className={`min-h-10 rounded-md px-2 text-xs font-medium ${policy === v ? 'bg-card text-fg' : 'text-muted'}`}>{t(l)}</button>)}
        </div>
      </section>
    </div>
  </Sheet>
}

/** Invite received: 10-second countdown, accept / decline */
export function PkInviteDialog({ pk }: { pk: Pk }) {
  const inv = pk.invite
  if (!inv) return null
  return <div className="absolute inset-x-3 top-20 z-30 rounded-2xl bg-card/95 p-4 shadow-xl backdrop-blur" role="alertdialog" aria-label={t('PK 邀请')} data-testid="pk-invite">
    <div className="flex items-center gap-3">
      <Avatar address={inv.from.host} src={inv.from.avatar} name={inv.from.nickname} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px] font-semibold"><span className="truncate">{displayName({ address: inv.from.host, nickname: inv.from.nickname })}</span><LevelBadge level={inv.from.level} role="streamer" size={16} /><StreakBadge n={inv.from.streak} size={14} /></div>
        <div className="text-xs text-muted">{t('邀请你 PK')} · <InviteCountdown expiresAt={inv.expiresAt} serverNow={inv.serverNow} /></div>
      </div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Button variant="secondary" onClick={() => pk.answer(inv.id, false)}><X size={16} />{t('拒绝')}</Button>
      <Button onClick={() => pk.answer(inv.id, true)}><Swords size={16} />{t('接受')}</Button>
    </div>
  </div>
}
function InviteCountdown({ expiresAt, serverNow }: { expiresAt: number; serverNow: number }) {
  const [start] = useState(() => Date.now())
  useTicker(true, 250)
  const left = Math.max(0, expiresAt - serverNow - (Date.now() - start))
  return <span className="number">{t('{n} 秒', { n: Math.ceil(left / 1000) })}</span>
}

/**
 * PK action bar under the streamer's picture: while live, "End PK"; on the end screen / draw, "Rematch" / "End call";
 * after a win, auto-match the next opponent in 5 seconds (cancellable); after a loss, "Find another"
 */
export function PkHostBar({ pk }: { pk: Pk }) {
  const s = pk.pk
  const [autoAt, setAutoAt] = useState<number | null>(null)
  useTicker(autoAt !== null, 250)
  useEffect(() => {
    if (pk.notice?.kind === 'won' && pk.notice.next === 'auto') setAutoAt(Date.now() + 5000)
  }, [pk.notice])
  useEffect(() => {
    if (autoAt === null) return
    const id = setTimeout(() => { setAutoAt(null); pk.clearNotice(); pk.queueUp(locale()) }, Math.max(0, autoAt - Date.now()))
    return () => clearTimeout(id)
  }, [autoAt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s?.phase === 'running') setAutoAt(null) }, [s?.phase])
  if (autoAt !== null) return <div className="flex items-center justify-between gap-2 rounded-xl bg-card2 px-3 py-2 text-sm" role="status" data-testid="pk-next">
    <span>{t('{n} 秒后匹配下一个对手', { n: Math.max(0, Math.ceil((autoAt - Date.now()) / 1000)) })}</span>
    <Button size="sm" variant="secondary" onClick={() => { setAutoAt(null); pk.clearNotice() }}>{t('取消')}</Button>
  </div>
  if (pk.queue.state === 'queued') return <div className="flex items-center justify-between gap-2 rounded-xl bg-card2 px-3 py-2 text-sm" role="status">
    <span className="flex items-center gap-2"><LoaderCircle size={15} className="animate-spin" />{t('正在匹配对手')}</span>
    <Button size="sm" variant="secondary" onClick={pk.cancelQueue}>{t('取消')}</Button>
  </div>
  if (!s) return pk.notice?.kind === 'lost' ? <div className="flex items-center justify-between gap-2 rounded-xl bg-card2 px-3 py-2 text-sm">
    <span>{t('这局输了，再来')}</span>
    <Button size="sm" onClick={() => { pk.clearNotice(); pk.queueUp(locale()) }}><Shuffle size={15} />{t('再找一个')}</Button>
  </div> : null
  if (s.phase === 'running') return <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={() => { if (confirm(t('现在结束这一局算你输，确定结束？'))) pk.leave() }}>{t('结束 PK')}</Button></div>
  return <div className="flex items-center justify-end gap-2">
    <Button size="sm" variant={s.rematch.me ? 'secondary' : 'primary'} disabled={s.rematch.me} onClick={pk.rematch}>{s.rematch.me ? t('等对方确认') : s.rematch.opp ? t('对方想再来一局') : t('再来一局')}</Button>
    <Button size="sm" variant="secondary" onClick={pk.leave}>{t('结束连线')}</Button>
  </div>
}
