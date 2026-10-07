// PK score bar + countdown + end screen (2026-09-30). Hosts and viewers in the live room all see this; the left side is always this room's host.
// End screen: win / loss / draw art + each side's top 3 (avatar and name only, no amounts); dwell time set by the server (30s default).
import Avatar from '@/components/Avatar'
import { t } from '@/lib/i18n'
import { displayName } from '@/store/social'
import { LIVE_IMG } from './img'
import { LevelBadge, RankMedal, StreakBadge } from './Badges'
import { mmss, pkRatio, useTicker, type PkState, type PkUser } from './pk'

export function PkBar({ pk, now }: { pk: PkState; now: () => number }) {
  useTicker(pk.phase === 'running' || pk.phase === 'result')
  const left = pk.endsAt - now()
  const ratio = pkRatio(pk.me.score, pk.opp.score)
  const label = pk.phase === 'running' ? mmss(left) : pk.phase === 'linked' ? t('平局 · 连线中') : t('本局结束')
  return <div className="pointer-events-none select-none px-3 pt-2" data-testid="pk-bar">
    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-white">
      <span className="flex min-w-0 items-center gap-1"><span className="truncate">{displayName({ address: pk.me.host, nickname: pk.me.nickname })}</span><LevelBadge level={pk.me.level} role="streamer" size={16} /><StreakBadge n={pk.me.streak} size={14} /></span>
      <span className={`number shrink-0 rounded-full px-2 py-0.5 ${pk.phase === 'running' && left < 30_000 ? 'bg-[#ff2d55]' : 'bg-black/50'}`} aria-live="off">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1"><StreakBadge n={pk.opp.streak} size={14} /><LevelBadge level={pk.opp.level} role="streamer" size={16} /><span className="truncate">{displayName({ address: pk.opp.host, nickname: pk.opp.nickname })}</span></span>
    </div>
    <div className="mt-1.5 flex h-6 overflow-hidden rounded-full bg-black/40 text-[12px] font-black text-white shadow-[0_2px_10px_rgba(0,0,0,.35)]" role="img" aria-label={t('比分 {a} 比 {b}', { a: pk.me.score, b: pk.opp.score })}>
      <div className="flex items-center bg-gradient-to-r from-[#ff2d55] to-[#ff7a45] pl-3 transition-[width] duration-500" style={{ width: `${ratio * 100}%` }}><span className="number">{pk.me.score}</span></div>
      <div className="flex flex-1 items-center justify-end bg-gradient-to-r from-[#3b82f6] to-[#22d3ee] pr-3"><span className="number">{pk.opp.score}</span></div>
    </div>
  </div>
}

/** End screen (centered when result / linked) */
export function PkResult({ pk }: { pk: PkState }) {
  if (pk.phase === 'running' || !pk.winner) return null
  const img = pk.winner === 'tie' ? LIVE_IMG.draw : pk.winner === 'me' ? LIVE_IMG.win : LIVE_IMG.lose
  const title = pk.winner === 'tie' ? t('平局') : pk.winner === 'me' ? t('{name} 赢了', { name: displayName({ address: pk.me.host, nickname: pk.me.nickname }) }) : t('{name} 赢了', { name: displayName({ address: pk.opp.host, nickname: pk.opp.nickname }) })
  return <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2 px-4" data-testid="pk-result" role="status">
    <img src={img} alt="" className="h-24 w-24 object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,.5)] pk-pop" draggable={false} />
    <div className="rounded-full bg-black/60 px-4 py-1.5 text-center text-[15px] font-bold text-white backdrop-blur">{title}</div>
    {/* When the result wasn't decided by the full timer, say why (so a 0:0 with a winner doesn't confuse) */}
    {pk.reason === 'quit' && <div className="rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/85" data-testid="pk-reason">{pk.winner === 'me' ? t('对方中途离开') : t('中途离开，判负')}</div>}
    {(pk.top.me.length > 0 || pk.top.opp.length > 0) && <div className="grid w-full max-w-[360px] grid-cols-2 gap-2">
      <TopList users={pk.top.me} />
      <TopList users={pk.top.opp} />
    </div>}
  </div>
}

function TopList({ users }: { users: PkUser[] }) {
  return <div className="rounded-xl bg-black/55 p-2 backdrop-blur">
    {users.length === 0 ? <p className="py-1 text-center text-[11px] text-white/60">{t('还没有人送礼')}</p>
      : users.map((u, i) => <div key={u.address} className="flex min-w-0 items-center gap-1.5 py-0.5">
        <RankMedal rank={i + 1} size={18} />
        <Avatar address={u.address} src={u.avatar} name={u.nickname} size={20} />
        <span className="min-w-0 truncate text-[11px] font-medium text-white">{displayName({ address: u.address, nickname: u.nickname })}</span>
      </div>)}
  </div>
}
