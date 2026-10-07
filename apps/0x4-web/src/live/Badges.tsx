// Level badges, streak marks, LIVE mark, lock (2026-09-30). Badges and flames are generated images with numbers overlaid; LIVE and the lock are hand-drawn SVG.
import { t } from '@/lib/i18n'
import { LIVE_IMG, badgeTier } from './img'

/** Level badge: role = viewer (viewer / gifting level) or streamer (host level). Level 1 hidden (meaningless and takes space), unless always */
export function LevelBadge({ level, role = 'viewer', size = 18, always = false, className = '' }: { level?: number | null; role?: 'viewer' | 'streamer'; size?: number; always?: boolean; className?: string }) {
  if (!level || (level < 2 && !always)) return null
  const src = (role === 'streamer' ? LIVE_IMG.streamer : LIVE_IMG.viewer)[badgeTier(level)]
  const label = role === 'streamer' ? t('主播等级 {n}', { n: level }) : t('等级 {n}', { n: level })
  return <span className={`relative inline-flex shrink-0 items-center justify-center align-middle ${className}`} style={{ width: size, height: size }} title={label} aria-label={label} role="img">
    <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
    <span className="relative font-black leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,.85)]" style={{ fontSize: Math.max(8, Math.round(size * 0.42)) }}>{level}</span>
  </span>
}

/** Streak: flame image + ×N (shown only when N ≥ 2) */
export function StreakBadge({ n, size = 16, className = '' }: { n?: number | null; size?: number; className?: string }) {
  if (!n || n < 2) return null
  const label = t('{n} 连胜', { n })
  return <span className={`inline-flex shrink-0 items-center gap-0.5 font-black text-[#ff7a45] ${className}`} title={label} aria-label={label} role="img">
    <img src={LIVE_IMG.streak} alt="" style={{ width: size, height: size }} className="object-contain" draggable={false} />
    <span className="number" style={{ fontSize: Math.round(size * 0.78) }}>×{n}</span>
  </span>
}

/** Red-background LIVE mark (hand-drawn, no emoji) */
export function LiveTag({ className = '' }: { className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full bg-[#ff2d55] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white ${className}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />LIVE
  </span>
}

/** Lock (private channel): hand-drawn SVG */
export function LockMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 120 160" className={className} aria-hidden="true">
    <rect x="10" y="70" width="100" height="84" rx="16" fill="currentColor" />
    <path d="M30 72 V48 a30 30 0 0 1 60 0 V72" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" />
    <circle cx="60" cy="104" r="11" fill="var(--color-bg, #0b0b10)" />
    <rect x="55" y="108" width="10" height="24" rx="5" fill="var(--color-bg, #0b0b10)" />
  </svg>
}

/** Rank medals 1–3 */
export function RankMedal({ rank, size = 22 }: { rank: number; size?: number }) {
  if (rank < 1 || rank > 3) return null
  return <img src={LIVE_IMG.rank[rank]} alt={t('第 {n} 名', { n: rank })} style={{ width: size, height: size }} className="shrink-0 object-contain" draggable={false} />
}
