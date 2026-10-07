// Livestream-start reminder banner (2026-09-30 goat): while the app / web is open, when someone you follow goes live, an image banner pops at the top, collapses after 6s; tapping it enters the live room.
// The notification-center entry is persisted by the server (liveNotify.ts); this only handles the top banner.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { renderServerText } from '@/lib/sysText'
import { LIVE_IMG } from './img'

interface Item { id: number; text: string; key?: unknown; params?: unknown; ref: string | null }
const useBanner = create<{ item: Item | null }>(() => ({ item: null }))
/** Called when the realtime connection receives a type='live' notification (store/social.ts) */
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
