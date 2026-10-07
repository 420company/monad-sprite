// 聊天多图消息：一个气泡里按宫格排（2 张两格、3 张三格、4 张 2×2、5~9 张三列），统一正方形裁切，可以混着视频。
// 点任意一格打开全屏查看器（左右滑、双指缩放、单张保存）。
// 还在发送的（pending）每格叠一个圆形进度；失败的在气泡旁边显示红色感叹号，点一下重发。
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Play } from 'lucide-react'
import ImageViewer, { type ViewerImage } from './ImageViewer'
import Avatar from './Avatar'
import type { Profile } from '@/lib/social'
import type { PendingFile } from '@/lib/usePendingMedia'
import { gridLayout, GRID_GAP, GRID_MAX_W } from '@/lib/multiMedia'
import { t } from '@/lib/i18n'

export interface GridItem {
  key: string
  kind: 'image' | 'video'
  /** 格子里显示的地址（缩略图 / 本机预览）；私信要先解密所以是异步的 */
  thumb: () => Promise<string>
  /** 全屏看的大图 / 视频 */
  full: () => Promise<string>
}
export interface GridPending { progress: number[]; state: 'uploading' | 'sending' | 'failed' }

/** 视频格子只显示第一帧：带 #t=0.1，iOS 才会画出画面而不是黑块 */
const frameOf = (u: string) => (u.includes('#') ? u : u + '#t=0.1')

/** 圆形进度：0~1；拿不到进度（发送中）时转圈 */
export function ProgressRing({ value, size = 34 }: { value?: number; size?: number }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r
  const spin = value === undefined
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={spin ? 'animate-spin' : ''} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={spin ? undefined : Math.round(value * 100)} aria-label={t('正在上传')}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.3)" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={spin ? c * 0.7 : c * (1 - Math.max(0.03, Math.min(1, value)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .2s linear' }} />
    </svg>
  )
}

function Cell({ item, style, className = '', progress, busy, onOpen }: { item: GridItem; style?: React.CSSProperties; className?: string; progress?: number; busy?: boolean; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const pressed = useRef(0)
  useEffect(() => {
    let alive = true
    setSrc(null); setErr(false)
    item.thumb().then((u) => { if (alive) setSrc(u) }).catch(() => { if (alive) setErr(true) })
    return () => { alive = false }
  }, [item.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const single = !style
  return (
    <button type="button" data-grid-cell
      // 长按是出菜单（外层气泡处理），松手后的这次点击不算打开
      onPointerDown={() => { pressed.current = Date.now() }}
      onClick={(e) => { e.stopPropagation(); const held = pressed.current > 0 && Date.now() - pressed.current > 450; pressed.current = 0; if (held || busy) return; onOpen() }}
      aria-label={item.kind === 'video' ? t('播放视频') : t('查看大图')}
      className={`relative block overflow-hidden bg-card2 ${loaded || err ? '' : 'animate-pulse'} ${className}`} style={style}>
      {src && (item.kind === 'video'
        ? <video src={frameOf(src)} muted playsInline preload="metadata" onLoadedData={() => setLoaded(true)} onError={() => setErr(true)} className={single ? 'block max-h-80 max-w-full' : 'absolute inset-0 h-full w-full object-cover'} />
        : <img src={src} alt={t('图片')} draggable={false} onLoad={() => setLoaded(true)} onError={() => setErr(true)} className={single ? 'block max-h-80 max-w-full' : 'absolute inset-0 h-full w-full object-cover'} />)}
      {single && !src && <span className="block h-40 w-40" />}
      {err && <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[11px] text-muted">{t('媒体已过期或无法解密')}</span>}
      {item.kind === 'video' && !busy && !err && <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white"><Play size={16} fill="currentColor" /></span></span>}
      {busy && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><ProgressRing value={progress} /></span>}
    </button>
  )
}

export default function MediaGrid({ items, pending, onRetry }: { items: GridItem[]; pending?: GridPending; onRetry?: () => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [fulls, setFulls] = useState<Record<number, string>>({})
  const asked = useRef(new Set<number>())
  // 看到第几张就加载它和左右两张的大图
  const want = (i: number) => {
    for (const j of [i, i - 1, i + 1]) {
      if (j < 0 || j >= items.length || asked.current.has(j)) continue
      asked.current.add(j)
      items[j].thumb().then((u) => setThumbs((m) => ({ ...m, [j]: u }))).catch(() => {})
      items[j].full().then((u) => setFulls((m) => ({ ...m, [j]: u }))).catch(() => { asked.current.delete(j) })
    }
  }
  const show = (i: number) => { want(i); setOpen(i) }
  const busyAt = (i: number) => !!pending && pending.state !== 'failed' && (pending.state === 'sending' || (pending.progress[i] ?? 0) < 1)
  const progressAt = (i: number) => (pending?.state === 'sending' ? undefined : pending?.progress[i] ?? 0)

  const viewerImages: ViewerImage[] = items.map((it, i) => ({ src: fulls[i], placeholder: it.kind === 'image' ? thumbs[i] : undefined, video: it.kind === 'video' }))
  const n = items.length
  const L = gridLayout(n)
  return (
    <div data-chat-image className="relative" style={{ maxWidth: GRID_MAX_W }}>
      {n === 1
        ? <Cell item={items[0]} className="rounded-xl" progress={progressAt(0)} busy={busyAt(0)} onOpen={() => show(0)} />
        : <div className="grid overflow-hidden rounded-xl" style={{ gridTemplateColumns: `repeat(${L.cols}, ${L.cell}px)`, gap: GRID_GAP, width: L.width }} role="group" aria-label={t('{n} 张图片', { n })}>
          {items.map((it, i) => <Cell key={it.key} item={it} style={{ width: L.cell, height: L.cell }} progress={progressAt(i)} busy={busyAt(i)} onOpen={() => show(i)} />)}
        </div>}
      {pending?.state === 'failed' && onRetry && (
        <button type="button" onClick={onRetry} className="absolute right-full top-1/2 mr-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-down" aria-label={t('发送失败，点击重发')} title={t('发送失败，点击重发')}>
          <AlertCircle size={22} fill="currentColor" stroke="var(--color-bg)" />
        </button>
      )}
      {open !== null && <ImageViewer images={viewerImages} index={open} onIndex={want} onClose={() => setOpen(null)} save />}
    </div>
  )
}

/** 语音上传中：屏幕中间一个半透明小胶囊，不占输入栏 */
export function UploadingToast() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" role="status">
      <span className="flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-sm text-white shadow-lg"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />{t('正在上传')}</span>
    </div>
  )
}

/** 正在发送的图片 / 视频：和自己发的消息同样的位置（头像在右），群聊和私信共用 */
export function PendingMediaRow({ album, self, onRetry }: { album: { id: string; items: PendingFile[]; progress: number[]; state: GridPending['state'] }; self?: Profile | null; onRetry: () => void }) {
  const items = useMemo<GridItem[]>(() => album.items.map((f, i) => ({ key: `${album.id}:${i}`, kind: f.kind, thumb: async () => f.local, full: async () => f.local })), [album.id, album.items])
  return (
    <div className="mt-3 flex flex-row-reverse items-start gap-2">
      <Avatar address={self?.address || ''} src={self?.avatar} name={self?.nickname} size={32} chainId={self?.avatarNft?.chainId} />
      <div className="flex min-w-0 max-w-[75%] flex-col items-end">
        <MediaGrid items={items} pending={{ progress: album.progress, state: album.state }} onRetry={onRetry} />
      </div>
    </div>
  )
}
