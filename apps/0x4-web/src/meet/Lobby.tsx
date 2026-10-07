// 会议等候室界面（2026-10-01 goat）：网页版 / 手机 App 的会议室用。逻辑在 lobbyCore.ts（和电脑端 meet/ 共用）。
//   · LobbyWaiting：等主持人同意的页面（不连音视频，服务器也不签令牌）
//   · LobbyHostCard：主持人 / 管理员看到的等待列表（允许 / 拒绝 / 全部允许），有人在等才出现
import { useEffect, useState } from 'react'
import { Check, DoorOpen, Hourglass, X } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { t } from '@/lib/i18n'
import { Spinner } from './ui'
import { waitedFor, type LobbyHost } from './lobbyCore'

export function LobbyWaiting({ title, hostName, onCancel }: { title: string; hostName: string; onCancel: () => void }) {
  return <div className="meet-ui relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center" data-testid="lobby-waiting" role="status">
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[.06] text-accent"><Hourglass size={28} /></span>
    <h1 className="font-display text-[26px] font-semibold tracking-tight">{t('等待主持人同意你加入')}</h1>
    <p className="max-w-[420px] text-[14px] text-muted">{title}<br />{t('主持人 {name}', { name: hostName })}</p>
    <div className="flex items-center gap-2 text-[13px] text-muted"><Spinner size={14} />{t('主持人同意后会自动进入')}</div>
    <button className="meet-btn meet-btn-ghost mt-2" onClick={onCancel}>{t('不等了')}</button>
  </div>
}

export function LobbyHostCard({ lobby }: { lobby: LobbyHost }) {
  const [, force] = useState(0)
  // 「等了多久」每 10 秒走一下
  useEffect(() => { if (!lobby.waiting.length) return; const id = setInterval(() => force((n) => n + 1), 10_000); return () => clearInterval(id) }, [lobby.waiting.length])
  if (!lobby.on || !lobby.waiting.length) return null
  const ago = (since: number) => { const w = waitedFor(since); return w.unit === 's' ? t('等了 {n} 秒', { n: w.n }) : t('等了 {n} 分钟', { n: w.n }) }
  return <div className="meet-fade meet-hairline fixed right-4 top-20 z-40 w-[min(360px,calc(100vw-32px))] rounded-2xl bg-[#13151d]/95 p-2 shadow-[0_20px_60px_-10px_rgb(0_0_0/.7)] backdrop-blur-md" data-testid="lobby-card" role="region" aria-label={t('等候室')}>
    <div className="flex items-center gap-2 px-2 py-1.5">
      <DoorOpen size={15} className="text-accent" />
      <span className="flex-1 text-[13px] font-semibold">{t('{n} 人在等候室', { n: lobby.waiting.length })}</span>
      {lobby.waiting.length > 1 && <button className="meet-btn meet-btn-primary h-8 px-3 text-[12.5px]" onClick={() => void lobby.admitAll()} data-testid="lobby-admit-all">{t('全部允许')}</button>}
    </div>
    <div className="max-h-[50vh] overflow-y-auto">
      {lobby.waiting.map((w) => <div key={w.address} className="flex items-center gap-2.5 rounded-xl px-2 py-2" data-testid="lobby-waiter">
        <Avatar address={w.address} src={w.avatar} name={w.name} size={32} />
        <div className="min-w-0 flex-1"><div className="truncate text-[13px]">{w.name}</div><div className="text-[11px] text-muted">{ago(w.since)}</div></div>
        <button className="meet-btn meet-btn-primary h-8 px-3 text-[12.5px]" onClick={() => void lobby.admit(w.address)} data-testid="lobby-admit"><Check size={14} />{t('允许')}</button>
        <button className="meet-btn meet-btn-ghost h-8 w-8 !px-0" onClick={() => void lobby.deny(w.address)} aria-label={t('拒绝')} title={t('拒绝')} data-testid="lobby-deny"><X size={15} /></button>
      </div>)}
    </div>
  </div>
}
