// 直播排行（2026-09-30）：PK 胜场（主播）和送礼（观众）的日榜、周榜，北京时间。不显示金额（送礼榜只排名次）。
import { useEffect, useState } from 'react'
import Sheet from '@/components/Sheet'
import Avatar from '@/components/Avatar'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { displayName } from '@/store/social'
import { useNavigate } from 'react-router-dom'
import { LevelBadge, RankMedal } from './Badges'

interface Row { address: string; nickname: string | null; avatar: string | null; level: number; wins?: number }

export default function RankSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [board, setBoard] = useState<'pk' | 'gift'>('pk')
  const [period, setPeriod] = useState<'day' | 'week'>('day')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    let alive = true
    setRows(null); setFailed(false)
    api<{ list: Row[] }>(`/api/live/rank?board=${board}&period=${period}`).then((r) => { if (alive) setRows(r.list) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [open, board, period])
  const seg = <T extends string>(value: T, set: (v: T) => void, items: [T, string][]) => <div className="grid grid-cols-2 gap-1 rounded-lg bg-card2 p-1" role="tablist">
    {items.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} onClick={() => set(v)} className={`min-h-9 rounded-md text-sm font-medium ${value === v ? 'bg-card text-fg' : 'text-muted'}`}>{t(l)}</button>)}
  </div>
  return <Sheet open={open} onClose={onClose} title={t('直播排行')}>
    <div className="space-y-3">
      {seg(board, setBoard, [['pk', 'PK 胜场'], ['gift', '送礼']])}
      {seg(period, setPeriod, [['day', '今天'], ['week', '本周']])}
      {failed ? <p className="py-8 text-center text-sm text-muted">{t('暂时无法加载排行')}</p>
        : !rows ? <div className="space-y-2 pt-2"><div className="skeleton h-12" /><div className="skeleton h-12" /></div>
        : !rows.length ? <p className="py-8 text-center text-sm text-muted">{board === 'pk' ? t('今天还没有人赢过 PK') : t('还没有人送礼')}</p>
        : <div className="divide-y divide-line/60">{rows.map((r, i) => <button key={r.address} onClick={() => { onClose(); nav(`/u/${r.address}`) }} className="flex w-full items-center gap-3 py-3 text-left">
          <span className="flex w-7 shrink-0 justify-center">{i < 3 ? <RankMedal rank={i + 1} size={24} /> : <span className="number text-sm text-muted">{i + 1}</span>}</span>
          <Avatar address={r.address} src={r.avatar} name={r.nickname} size={36} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5"><span className="truncate text-[15px] font-medium">{displayName({ address: r.address, nickname: r.nickname })}</span><LevelBadge level={r.level} role={board === 'pk' ? 'streamer' : 'viewer'} size={18} /></span>
          {board === 'pk' && <span className="number shrink-0 text-sm text-muted">{t('{n} 胜', { n: r.wins ?? 0 })}</span>}
        </button>)}</div>}
    </div>
  </Sheet>
}
