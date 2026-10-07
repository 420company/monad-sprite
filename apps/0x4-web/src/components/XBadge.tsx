// 昵称右侧的 X 标记：只有绑定过 X 的用户才显示，点一下弹出对方的 X 资料卡。
//
// 用居中小弹窗而不是整屏弹层：卡片内容就这么多，撑满一屏下面全是空白。
// 交互沿用 AlertDialog 那套：原生 <dialog>、点背景关、Esc 关。
//
// 取数说明：地址攒一小段时间批量问一次服务端（/api/users/x-handles），结果缓存在内存里，
// 没绑的也缓存成 null，避免同一个人在动态、聊天、排行里出现十次就问十次。
// 资料（头像、昵称、简介、粉丝数）是用户授权绑定的那一刻存下来的，不是实时抓的。
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
  /** 顶部横幅，X 有就有，没有就退回头像模糊 */
  banner: string | null
  bio: string | null
  verified: boolean
  /** ISO 时间，X 上的注册时间 */
  joined: string | null
  followers: number | null
  following: number | null
}

interface XState {
  /** 地址 → X 资料；null = 没绑定（已问过） */
  profiles: Record<string, XProfile | null>
  ensure: (address: string) => void
  /** 自己刚绑完 / 解绑时更新，不用等下次批量 */
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
        // 没问到就不写缓存，下次进页面再问
      }
    }, 120)
  },
}))

export default function XBadge({ address, size = 13 }: { address?: string | null; size?: number }) {
  const profile = useXHandles((s) => (address ? s.profiles[address] : undefined))
  const ensure = useXHandles((s) => s.ensure)
  const [open, setOpen] = useState(false)
  /** 头像挂了（X 换过图、被墙）就退回 X 图标，别留个破图框 */
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
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}   // 点按的轻震由全局按键震动负责（lib/pressHaptics.ts），关掉「按键震动」就不震
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
          {/* 整张卡的背景用本人的 X 横幅；没有横幅就拿头像放大模糊顶上，
              上面压一层暗色让文字读得清 */}
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

            {/* 头像在左，信息在右 */}
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
                {/* 不显示 X 个人简介：那是他在 X 上的自我介绍，放这里既占地方也容易带进
                    与本产品无关的内容。数据库里仍存着，需要时可以再放出来 */}
                {/* 不显示粉丝数 / 关注数：只有绑定那一刻的快照，显示出来是过期数字。
                    加入时间不会变，可以放心显示。数据库里仍存着，将来做定期刷新不用重取 */}
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

/** X 的官方图标形状 */
function XLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
