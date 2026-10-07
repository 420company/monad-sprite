// Post images: lists always show thumbnails (1 keeps aspect ratio, max 280 tall; 2–4 in a grid; beyond 4, the 4th cell overlays +N); tap for fullscreen.
// When dimensions are known, reserve the space by aspect ratio up front — the image arriving won't push content below down.
import { useState } from 'react'
import ImageViewer from './ImageViewer'
import { SOCIAL_API } from '@/lib/social'
import { absUrl, thumbOf, type PostImage } from '@/lib/postImage'
import { t } from '@/lib/i18n'

const src = (u: string) => absUrl(u, SOCIAL_API)
const SINGLE_MAX_H = 280

function Cell({ img, className = '', style, onOpen, children }: { img: PostImage; className?: string; style?: React.CSSProperties; onOpen: () => void; children?: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen() }} className={`relative block overflow-hidden bg-card ${loaded ? '' : 'animate-pulse'} ${className}`} style={style} aria-label={t('查看大图')}>
      <img src={src(thumbOf(img))} alt={t('动态图片')} loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
      {children}
    </button>
  )
}

/** mode=grid: feed thumbnails; mode=full: detail page, each image full-width at its natural aspect ratio */
export default function PostImages({ images, mode = 'grid', className = 'mt-3' }: { images: PostImage[]; mode?: 'grid' | 'full'; className?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!images.length) return null
  const viewer = open !== null && <ImageViewer images={images.map((x) => ({ src: src(x.url), placeholder: src(thumbOf(x)) }))} index={open} onClose={() => setOpen(null)} />

  if (mode === 'full') return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {images.map((img, i) => {
        const ratio = img.w && img.h ? img.w / img.h : undefined
        return (
          <button key={i} type="button" onClick={() => setOpen(i)} className="relative block w-full overflow-hidden rounded-lg bg-card" style={ratio ? { aspectRatio: String(ratio) } : { minHeight: 160 }} aria-label={t('查看大图')}>
            <img src={src(img.url)} alt={t('动态图片')} loading={i > 1 ? 'lazy' : undefined} draggable={false} className={ratio ? 'absolute inset-0 h-full w-full object-cover' : 'block w-full'} />
          </button>
        )
      })}
      {viewer}
    </div>
  )

  if (images.length === 1) {
    const img = images[0]
    // Crop anything too tall or too wide: aspect ratio clamped to 3:4 – 2:1; old images with unknown dimensions default to 4:3
    const ratio = img.w && img.h ? Math.min(2, Math.max(3 / 4, img.w / img.h)) : 4 / 3
    return <div className={className}>
      <Cell img={img} onOpen={() => setOpen(0)} className="rounded-lg" style={{ aspectRatio: String(ratio), width: `${Math.round(SINGLE_MAX_H * ratio)}px`, maxWidth: '100%' }} />
      {viewer}
    </div>
  }

  const shown = images.slice(0, 4)
  const more = images.length - shown.length
  const cols = shown.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
  const cellRatio = shown.length === 4 ? '4 / 3' : '1'
  return <div className={className}>
    <div className={`grid max-w-md gap-0.5 overflow-hidden rounded-lg ${cols}`}>
      {shown.map((img, i) => (
        <Cell key={i} img={img} onOpen={() => setOpen(i)} style={{ aspectRatio: cellRatio }}>
          {i === 3 && more > 0 && <span className="number absolute inset-0 flex items-center justify-center bg-black/45 text-2xl font-semibold text-white">+{more}</span>}
        </Cell>
      ))}
    </div>
    {viewer}
  </div>
}
