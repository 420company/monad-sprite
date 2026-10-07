// 开播提醒横幅（2026-09-30 goat）：App / 网页开着时，关注的人开播，顶部弹一条带图的横幅，6 秒后收起，点了进直播间。
// 通知中心那一条由服务器落库（liveNotify.ts），这里只负责顶部横幅。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { renderServerText } from '@/lib/sysText'
import { LIVE_IMG } from './img'

interface Item { id: number; text: string; key?: unknown; params?: unknown; ref: string | null }
const useBanner = create<{ item: Item | null }>(() => ({ item: null }))
/** 实时连接收到 type='live' 的通知时调用（store/social.ts） */
export function pushLiveBanner(n: { id: number; text: string; key?: unknown; params?: unknown; ref: string | null }) { useBanner.setState({ item: n }) }

export default function LiveBanner() {
  const item = useBanner((s) => s.item)
  const nav = useNavigate()
  const [shown, setShown] = useState<Item | null>(null)
  useEffect(() => {
    if (!item) return
    setShown(item)
    const x = setTimeout(() => { setShown(null); useBanner.setState({ item: null }) }, 6000)
    return () => clearTimeout(x)
  }, [item])
  if (!shown) return null
  const room = shown.ref?.startsWith('live:') ? shown.ref.slice(5) : null
  const close = () => { setShown(null); useBanner.setState({ item: null }) }
  return <div className="safe-top pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-2" data-testid="live-banner">
    <div className="pointer-events-auto flex w-full max-w-[460px] items-center gap-3 rounded-2xl bg-card/95 p-2.5 pr-2 shadow-2xl ring-1 ring-line backdrop-blur" role="status">
      <img src={LIVE_IMG.golive} alt="" className="h-11 w-11 shrink-0 object-contain" draggable={false} />
      <button className="min-w-0 flex-1 text-left" onClick={() => { close(); if (room) nav(`/room/${room}`) }}>
        <p className="line-clamp-2 text-sm font-medium">{renderServerText(shown.text, shown.key, shown.params)}</p>
        <p className="mt-0.5 text-xs text-accent">{t('去看直播')}</p>
      </button>
      <button className="icon-button shrink-0 text-muted" onClick={close} aria-label={t('关闭')}><X size={16} /></button>
    </div>
  </div>
}
