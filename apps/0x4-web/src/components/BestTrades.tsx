// 首页「每周最佳交易」：本周已实现盈亏最高的卖出
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb } from 'lucide-react'
import Avatar from './Avatar'
import TokenLogo from './TokenLogo'
import { api } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { useSocial, displayName } from '@/store/social'
import XBadge from '@/components/XBadge'
import { t } from '@/lib/i18n'
import UserName from './UserName'

interface Best { id: string; address: string; nickname: string | null; avatar: string | null; handle: string | null; symbol: string; logo: string | null; chain: string; token: string; realized: number }

export default function BestTrades() {
  const status = useSocial((s) => s.status)
  const [list, setList] = useState<Best[]>([])
  useEffect(() => { api<Best[]>('/api/trades/best?period=7d').then((l) => setList(l.filter((x) => x.realized > 0))).catch(() => {}) }, [status])
  if (!list.length) return null
  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 px-4 pb-2 font-bold"><Lightbulb size={16} className="text-muted" /> {t('每周最佳交易')}</h2>
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
        {list.map((b) => (
          <div key={b.id} className="w-44 shrink-0 rounded-2xl bg-card p-3">
            <Link to={`/u/${b.address}`} className="flex items-center gap-1.5 rounded-xl bg-card2 px-2 py-1.5"><Avatar address={b.address} src={b.avatar} name={b.nickname} size={22} /><UserName address={b.address} name={b.handle || displayName(b)} className="truncate text-sm font-semibold" /><XBadge address={b.address} size={11} /></Link>
            <Link to={`/token/${b.chain}/${b.token}`} className="mt-3 flex items-center gap-2"><TokenLogo src={b.logo || undefined} symbol={b.symbol} size={28} /><span className="text-sm font-bold text-up">+{fmtUsd(b.realized)}</span></Link>
          </div>
        ))}
      </div>
    </section>
  )
}
