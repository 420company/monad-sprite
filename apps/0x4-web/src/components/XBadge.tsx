// X badge next to the nickname: only shown for users who bound X; tapping pops their X profile card.
//
// A centered small dialog instead of a full-screen sheet: the card only has this much content — full screen would leave empty space below.
// Interaction reuses AlertDialog's pattern: native <dialog>, backdrop click closes, Esc closes.
//
// Data fetching: addresses accumulate briefly then ask the server once in batch (/api/users/x-handles), results cached in memory,
// unbound ones cached as null too, so a person appearing ten times across feed, chat, and rankings doesn't trigger ten requests.
// Profile data (avatar, name, bio, follower count) was snapshotted at the moment the user authorized binding — not scraped live.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { create } from 'zustand'
import { BadgeCheck, UserRound, X as XIcon } from 'lucide-react'
import { api } from '@/lib/social'
import { copyText, isNative, openExternal } from '@/lib/native'
import { toast } from './Toast'
import { t } from '@/lib/i18n'

export interface XProfile {
  handle: string
  name: string | null
  avatar: string | null
  /** Top banner: use X's if there is one, else fall back to a blurred avatar */
  banner: string | null
  bio: string | null
  verified: boolean
  /** ISO time, the X account's creation time */
  joined: string | null
  followers: number | null
  following: number | null
}

interface XState {
  /** Address → X profile; null = not bound (already asked) */
  profiles: Record<string, XProfile | null>
  ensure: (address: string) => void
  /** Updated right after I bind / unbind — no waiting for the next batch */
  set: (address: string, profile: XProfile | null) => void
}

let queue = new Set<string>()
let timer: number | null = null

export const useXHandles = create<XState>()((set, get) => ({
  profiles: {},
  set: (address, profile) => set({ profiles: { ...get().profiles, [address]: profile } }),
  ensure: (address) => {
    if (!address || address in get().profiles || queue.has(address)) return
    queue.add(address)
    if (timer !== null) return
    timer = window.setTimeout(async () => {
      const batch = [...queue]
      queue = new Set()
      timer = null
      try {
        const r = await api<Record<string, XProfile | null>>(`/api/users/x-handles?addresses=${batch.join(',')}`)
        set({ profiles: { ...get().profiles, ...r } })
      } catch {
        // Don't cache when the ask failed — ask again on next page entry
      }
    }, 120)
  },
}))

export default function XBadge({ address, size = 13 }: { address?: string | null; size?: number }) {
  const profile = useXHandles((s) => (address ? s.profiles[address] : undefined))
  const ensure = useXHandles((s) => s.ensure)
  const [open, setOpen] = useState(false)
  /** If the avatar fails (X changed the image, or it's blocked), fall back to the X icon — never leave a broken image frame */
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => { if (address) ensure(address) }, [address, ensure])
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', ''))
    if (!open && d.open) d.close()
  }, [open])

  if (!address || !profile) return null

  const url = `https://x.com/${profile.handle}`
  const joined = profile.joined ? new Date(profile.joined) : null
  const bg = (profile.banner && !bannerFailed ? profile.banner : null) || (profile.avatar && !avatarFailed ? profile.avatar : null)
  const close = () => setOpen(false)

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}   // Tap haptics are handled by the global key haptic (lib/pressHaptics.ts) — off when "key haptics" is disabled
        aria-label={t('X 账号 @{handle}', { handle: profile.handle })}
        title={`X @${profile.handle}`}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-85"
        style={{ width: size + 8, height: size + 8 }}
      >
        <XLogo size={Math.round(size * 0.72)} />
      </button>

      <dialog
        ref={dialog}
        onCancel={(e) => { e.preventDefault(); close() }}
        onClick={(e) => { if (e.target === e.currentTarget) close() }}
        aria-label={t('X 账号 @{handle}', { handle: profile.handle })}
        className="m-auto w-[calc(100%-3rem)] max-w-sm overflow-hidden rounded-2xl border border-line bg-card p-0 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-[alert-in_.22s_cubic-bezier(.16,1,.3,1)]"
      >
        {open && <div className="relative">
          {/* The whole card's background uses the person's X banner; without a banner, fall back to their enlarged blurred avatar,
              with a dark overlay so text stays readable */}
          <div className="absolute inset-0 overflow-hidden">
            {bg
              ? <img src={bg} alt="" aria-hidden="true"
                  className={`h-full w-full object-cover ${profile.banner && !bannerFailed ? 'opacity-45' : 'scale-150 opacity-35 blur-2xl'}`}
                  onError={() => (profile.banner && !bannerFailed ? setBannerFailed(true) : setAvatarFailed(true))} />
              : <div className="h-full w-full bg-gradient-to-br from-accent/25 via-card2 to-social/25" />}
            <div className="absolute inset-0 bg-gradient-to-b from-card/55 via-card/85 to-card" />
          </div>

          <div className="relative p-4">
            <button
              onClick={close}
              aria-label={t('关闭')}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"
            ><XIcon size={17} /></button>

            {/* Avatar on the left, info on the right */}
            <div className="flex items-start gap-3 pr-10">
              {profile.avatar && !avatarFailed
                ? <img src={profile.avatar} alt="" onError={() => setAvatarFailed(true)}
                    className="h-16 w-16 shrink-0 rounded-full border-2 border-card bg-card2 object-cover" loading="lazy" />
                : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-card bg-card2 text-fg"><XLogo size={24} /></span>}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-lg font-bold">{profile.name || profile.handle}</span>
                  {profile.verified && <BadgeCheck size={17} className="shrink-0 text-social" aria-label={t('X 认证账号')} />}
                </div>
                <button
                  onClick={() => copyText(`@${profile.handle}`).then(() => toast.success(t('已复制'))).catch(() => toast.error(t('复制失败')))}
                  className="block max-w-full truncate text-sm text-muted"
                  title={t('复制')}
                >@{profile.handle}</button>
                {/* Don't show the X bio: it's their self-intro on X — takes space here and can bring in
                    content unrelated to this product. Still stored in the DB, can be shown again when needed */}
                {/* Don't show follower / following counts: they're snapshots from binding time — stale numbers. Join date never changes, safe to show.
                    Still stored in the DB, so future periodic refreshes don't need re-fetching */}
                {joined && <div className="mt-1.5 text-xs text-muted">{t('{year} 年 {month} 月加入 X', { year: joined.getFullYear(), month: joined.getMonth() + 1 })}</div>}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => { if (isNative) openExternal(url).catch(() => toast.error(t('打不开'))); else window.open(url, '_blank', 'noopener') }}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-fg text-sm font-semibold text-bg"
              ><XLogo size={14} />{t('在 X 上查看')}</button>
              <Link
                to={`/u/${address}`}
                onClick={close}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card2/80 text-sm font-semibold backdrop-blur-sm"
              ><UserRound size={16} />{t('0x4 主页')}</Link>
            </div>

          </div>
        </div>}
      </dialog>
    </>
  )
}

/** X's official icon shape */
function XLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
