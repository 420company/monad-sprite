// 直播点赞（2026-09-30）：一秒能连点十几下，每下都飘一颗心；本地攒 300 毫秒发一次（服务器每人每秒最多收 15 下）。
// 直播间点赞数每下都算；主页「获赞」每个观众每场只算 1（服务器 liveSocial.ts）。
import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { t } from '@/lib/i18n'
import { useSocial } from '@/store/social'

const COLORS = ['#ff2d55', '#ff7a45', '#ffd166', '#a78bfa', '#22d3ee']

export default function LikeButton({ roomId, total, disabled }: { roomId: string; total: number | null; disabled?: boolean }) {
  const socket = useSocial((s) => s.socket)
  const pending = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hearts, setHearts] = useState<{ id: number; x: number; c: string }[]>([])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const flush = () => { timer.current = null; const n = pending.current; pending.current = 0; if (n) socket?.send({ type: 'roomlike', roomId, n }) }
  const tapLike = () => {
    if (disabled) return
    pending.current++
    if (!timer.current) timer.current = setTimeout(flush, 300)
    const id = Date.now() + Math.random()
    setHearts((h) => [...h.slice(-24), { id, x: Math.round(Math.random() * 28 - 14), c: COLORS[Math.floor(Math.random() * COLORS.length)] }])
    setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 1400)
  }
  return <div className="relative">
    {hearts.map((h) => <span key={h.id} className="like-float pointer-events-none absolute bottom-10 left-1/2" style={{ ['--x' as string]: `${h.x}px`, color: h.c }} aria-hidden="true"><Heart size={20} fill="currentColor" strokeWidth={0} /></span>)}
    <button onClick={tapLike} disabled={disabled} className="icon-button relative h-12 w-12 bg-card2 text-[#ff2d55] disabled:opacity-40" aria-label={t('点赞')} title={t('点赞')} data-testid="like-button">
      <Heart size={21} fill="currentColor" strokeWidth={0} />
      {total !== null && total > 0 && <span className="number absolute -right-1 -top-1 min-w-5 rounded-full bg-[#ff2d55] px-1 text-[10px] font-bold leading-5 text-white">{total > 9999 ? `${Math.floor(total / 1000)}k` : total}</span>}
    </button>
  </div>
}
