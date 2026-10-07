// Small sheets in the live room (2026-09-30): share, audience actions (follow / mute / kick / set as mod), entry effects, the guest 15-second login popup.
import { useEffect, useState } from 'react'
import { Ban, Copy, Link2, LogIn, MicOff, Shield, ShieldOff, UserX } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import Avatar from '@/components/Avatar'
import FollowButton from '@/components/FollowButton'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { copyText, openExternal } from '@/lib/native'
import { displayName } from '@/store/social'
import { LIVE_IMG } from './img'
import { LevelBadge } from './Badges'
import { shareUrl, xIntentUrl } from './share'
import { guestGateOpen } from './guest'

/** Share: post to X (opens the compose box with copy and link prefilled) / copy link */
export function ShareSheet({ open, onClose, kind, id, title, hostName }: { open: boolean; onClose: () => void; kind: 'live' | 'meet'; id: string; title: string; hostName: string }) {
  const url = shareUrl(kind, id)
  const text = kind === 'live' ? t('{name} 正在 0x4 直播：{title}', { name: hostName, title }) : t('来 0x4 参加会议：{title}', { title })
  return <Sheet open={open} onClose={onClose} title={t('分享')} half>
    <div className="space-y-3">
      <Button size="lg" className="w-full" onClick={() => { void openExternal(xIntentUrl(text, url)); onClose() }} data-testid="share-x">
        <XLogo />{t('分享到 X')}
      </Button>
      <Button size="lg" variant="secondary" className="w-full" onClick={() => copyText(url).then(() => { toast.success(t('链接已复制')); onClose() }, () => toast.error(t('复制失败')))} data-testid="share-copy">
        <Copy size={18} />{t('复制链接')}
      </Button>
      <p className="flex items-center gap-2 break-all rounded-lg bg-card2 px-3 py-2 text-xs text-muted"><Link2 size={14} className="shrink-0" />{url}</p>
    </div>
  </Sheet>
}
/** The X logo (hand-written SVG) */
function XLogo() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1 2h6.4l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L6.3 3.8H4.5l13.3 16.3Z" /></svg>
}

export interface ModInfo { role: 'host' | 'admin' | 'viewer'; host: string; muted: boolean; admins: { address: string; nickname: string }[]; mutedList: { address: string }[]; maxAdmins: number }

/** Tapping someone in danmaku: view profile, follow; streamers / mods can also mute or kick; streamers can appoint mods */
export function ViewerSheet({ open, onClose, roomId, user, mod, onChanged }: {
  open: boolean; onClose: () => void; roomId: string; user: { address: string; nickname: string | null; avatar?: string | null; level?: number } | null
  mod: ModInfo | null; onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  if (!user) return null
  const isHostTarget = mod?.host === user.address
  const targetAdmin = !!mod?.admins.some((a) => a.address === user.address)
  const targetMuted = !!mod?.mutedList.some((a) => a.address === user.address)
  const canMod = !!mod && mod.role !== 'viewer' && !isHostTarget && !(mod.role === 'admin' && targetAdmin)
  const act = async (key: string, url: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key)
    try { await api(`/api/rooms/${roomId}/${url}`, { method: 'POST', body: JSON.stringify({ address: user.address, ...body }) }); toast.success(ok); onChanged(); onClose() }
    catch (e) { toast.error(errorText(e, t('操作失败'))) } finally { setBusy(null) }
  }
  return <Sheet open={open} onClose={onClose} title={displayName({ address: user.address, nickname: user.nickname })} half>
    <div className="flex items-center gap-3">
      <Avatar address={user.address} src={user.avatar} name={user.nickname} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-base font-semibold"><span className="truncate">{displayName({ address: user.address, nickname: user.nickname })}</span><LevelBadge level={user.level} size={18} /></div>
        {targetAdmin && <p className="mt-0.5 text-xs text-accent">{t('房管')}</p>}
      </div>
      <FollowButton address={user.address} />
    </div>
    {canMod && <div className="mt-5 grid gap-2">
      <Button variant="secondary" loading={busy === 'mute'} onClick={() => void act('mute', 'mute', { on: !targetMuted }, targetMuted ? t('已解除禁言') : t('已禁言'))}><MicOff size={16} />{targetMuted ? t('解除禁言') : t('禁言（本场）')}</Button>
      <Button variant="secondary" className="text-down" loading={busy === 'kick'} onClick={() => { if (confirm(t('踢出后这场直播里他进不来了，确定？'))) void act('kick', 'kick', {}, t('已踢出')) }}><UserX size={16} />{t('踢出直播间')}</Button>
      {mod?.role === 'host' && <Button variant="secondary" loading={busy === 'admin'} disabled={!targetAdmin && mod.admins.length >= mod.maxAdmins}
        onClick={() => void act('admin', 'admins', { on: !targetAdmin }, targetAdmin ? t('已取消房管') : t('已设为房管'))}>
        {targetAdmin ? <><ShieldOff size={16} />{t('取消房管')}</> : <><Shield size={16} />{mod.admins.length >= mod.maxAdmins ? t('房管已满（最多 {n} 个）', { n: mod.maxAdmins }) : t('设为房管')}</>}
      </Button>}
    </div>}
  </Sheet>
}

/** Entry effects: from audience level 10 / 25 / 40, an illustrated banner floats at the bottom, gone after 3s */
export function EnterBanner({ item }: { item: { key: string; nickname: string; level: number; tier: number } | null }) {
  if (!item) return null
  return <div key={item.key} className="enter-banner pointer-events-none absolute left-0 top-[38%] z-20 flex h-10 w-[78%] max-w-[360px] items-center" data-testid="enter-banner">
    <img src={LIVE_IMG.enter[item.tier] || LIVE_IMG.enter[10]} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} />
    <span className="relative ml-10 flex min-w-0 items-center gap-1.5 text-[13px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.8)]">
      <LevelBadge level={item.level} size={20} /><span className="truncate">{t('{name} 来了', { name: item.nickname })}</span>
    </span>
  </div>
}

/**
 * Guests (entered via a share link, not logged in): can watch 15 seconds, then a login dialog pops; the stream keeps playing behind; the dialog stays, unclosable, until they log in.
 * elapsedMs is passed in from outside (for tests); real time is used when absent
 */
export function GuestGate({ loggedIn, onLogin, startedAt }: { loggedIn: boolean; onLogin: () => void; startedAt: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (loggedIn) return
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [loggedIn])
  if (!guestGateOpen(Date.now() - startedAt, loggedIn)) return null
  // Deliberately no close button, and tapping the background doesn't dismiss (goat: the dialog stays until login)
  return <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/35 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={t('登录后继续观看')} data-testid="guest-gate">
    <div className="w-full max-w-[380px] rounded-2xl bg-bg p-5 text-center text-fg shadow-2xl ring-1 ring-line">
      <img src={LIVE_IMG.golive} alt="" className="mx-auto h-16 w-16 object-contain" draggable={false} />
      <h2 className="mt-3 text-lg font-bold">{t('登录后继续观看')}</h2>
      <p className="mt-1.5 text-sm text-muted">{t('登录 0x4 就能聊天、点赞、关注主播。')}</p>
      <Button size="lg" className="mt-5 w-full" onClick={onLogin} data-testid="guest-login"><LogIn size={18} />{t('登录')}</Button>
    </div>
  </div>
}

/** Kicked out / stream closed by the platform / blocked: full-page notice */
export function RoomGone({ kind, onBack }: { kind: 'kicked' | 'dissolved' | 'blocked' | 'ended'; onBack: () => void }) {
  const text = kind === 'kicked' ? t('你已被移出这场直播') : kind === 'dissolved' ? t('直播间已被平台关闭') : kind === 'blocked' ? t('无法进入这个直播间') : t('直播已结束')
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center" role="status" data-testid="room-gone">
    <Ban size={30} className="text-muted" />
    <h2 className="text-lg font-semibold">{text}</h2>
    <Button variant="secondary" onClick={onBack}>{t('返回')}</Button>
  </div>
}
