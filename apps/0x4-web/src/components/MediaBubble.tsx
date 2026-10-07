// Image / video / voice message rendering; voice uses a custom-drawn player (duration + progress)
import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { SOCIAL_API } from '@/lib/social'
import { toast } from './Toast'
import { parseDmMedia, decryptToUrl, decryptThumbUrl, dmMediaItems, type DmMedia } from '@/lib/dmMedia'
import MediaGrid, { type GridItem } from './MediaGrid'
import type { GroupAlbumItem } from '@/store/social'
import { absUrl, resolveImage } from '@/lib/postImage'
import ImageViewer from './ImageViewer'
import { cachedMediaUrl } from '@/lib/mediaCache'
import { t } from '@/lib/i18n'

/** The voice message currently playing */
let current: HTMLAudioElement | null = null

export function VoicePlayer({ src, duration, mine }: { src: string; duration?: number; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const dur = duration || audio.current?.duration || 0
  const toggle = () => {
    const a = audio.current; if (!a) return
    if (playing) { a.pause(); setPlaying(false); return }
    // Only one plays at a time; reload ones that failed last time; ensure it's not muted and volume is full
    if (current && current !== a) current.pause()
    current = a
    if (a.error) a.load()
    a.muted = false; a.volume = 1
    a.play().then(() => setPlaying(true)).catch(() => toast.error(t('这段语音无法在当前浏览器播放')))
  }
  const width = Math.min(220, 80 + dur * 8)
  return (
    <button onClick={toggle} className="flex items-center gap-2" style={{ width }} aria-label={t('播放语音')}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${mine ? 'bg-bg/20' : 'bg-accent/20 text-accent'}`}>{playing ? <Pause size={14} /> : <Play size={14} />}</span>
      <span className={`h-1.5 flex-1 overflow-hidden rounded-full ${mine ? 'bg-bg/30' : 'bg-line'}`}><span className={`block h-full ${mine ? 'bg-bg' : 'bg-accent'}`} style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} /></span>
      <span className="shrink-0 text-xs">{t('{n} 秒', { n: Math.round(dur) })}</span>
      <audio ref={audio} src={src} preload="metadata" onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setPos(0) }} onPause={() => setPlaying(false)} onError={() => setPlaying(false)} />
    </button>
  )
}

/** Group message media (plaintext URLs). Viewed ones are cached on-device — still viewable after the server's file expires */
export function GroupMedia({ kind, url, duration, mine }: { kind: string; url: string; duration?: number; mine?: boolean }) {
  // Images in bubbles only pull the thumbnail (new uploads' filenames carry the thumbnail URL plus dimensions); tap to open the full image
  const img = kind === 'image' ? resolveImage({ url }) : null
  const remote = absUrl(img?.thumb || url, SOCIAL_API)
  const [local, setLocal] = useState<string | null>(remote.startsWith('blob:') ? remote : null)
  useEffect(() => {
    if (remote.startsWith('blob:')) { setLocal(remote); return }
    let alive = true
    setLocal(null)
    // If caching and downloading both fail (offline, cross-origin), fall back to the original URL directly
    cachedMediaUrl(remote).then((u) => { if (alive) setLocal(u) }).catch(() => { if (alive) setLocal(remote) })
    return () => { alive = false }
  }, [remote])
  if (!local && img?.w && img.h) return <div data-chat-image className="max-w-full animate-pulse rounded-xl bg-card2" style={chatImageBox(img.w / img.h)} aria-label={t('加载中…')} />
  if (!local) return kind === 'voice' ? <span className="text-xs opacity-70">{t('加载中…')}</span> : <div className="h-32 w-44 max-w-full animate-pulse rounded-xl bg-card2" aria-label={t('加载中…')} />
  if (img) return <ChatImage src={local} ratio={img.w && img.h ? img.w / img.h : undefined} loadFull={() => cachedMediaUrl(absUrl(url, SOCIAL_API)).catch(() => absUrl(url, SOCIAL_API))} />
  return <MediaView kind={kind} full={local} href={remote} duration={duration} mine={mine} />
}

/** Aspect-ratio placeholder: max height 320, max width 240 (group chat bubbles have no max-w — percentages can't hold it, so a fixed width is the only option); extra-long ones cropped to 1:3 – 3:1 */
const CHAT_IMAGE_MAX_W = 240
const chatImageBox = (ratio: number) => { const r = Math.min(3, Math.max(1 / 3, ratio)); return { aspectRatio: String(r), width: `${Math.round(Math.min(320 * r, CHAT_IMAGE_MAX_W))}px`, maxWidth: '100%' } }

/** Images in chat: no bubble background, shown directly, 12px corners, aspect-kept, max height 320; tap for fullscreen */
function ChatImage({ src, ratio, loadFull }: { src: string; ratio?: number; loadFull: () => Promise<string> }) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<string | undefined>()
  const [loaded, setLoaded] = useState(false)
  const show = () => { setOpen(true); if (!full) loadFull().then(setFull).catch(() => setFull(src)) }
  const box = ratio ? chatImageBox(ratio) : undefined
  return <>
    <button type="button" data-chat-image onClick={show} aria-label={t('查看大图')}
      className={`relative block max-w-full overflow-hidden rounded-xl bg-card2 ${loaded ? '' : 'animate-pulse'}`}
      style={box}>
      <img src={src} alt={t('图片')} draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
        className={box ? 'absolute inset-0 h-full w-full object-cover' : 'block max-h-80 max-w-full'} />
    </button>
    {open && <ImageViewer images={[{ src: full, placeholder: src }]} index={0} onClose={() => setOpen(false)} save />}
  </>
}

function MediaView({ kind, full, href = full, duration, mine }: { kind: string; full: string; href?: string; duration?: number; mine?: boolean }) {
  if (kind === 'image') return <a href={href} target="_blank" rel="noreferrer"><img src={full} alt={t('图片')} className="max-h-64 max-w-full rounded-xl" /></a>
  if (kind === 'video') return <video src={full} controls playsInline preload="metadata" className="max-h-64 max-w-full rounded-xl bg-black" />
  if (kind === 'voice') return <VoicePlayer src={full} duration={duration} mine={mine} />
  return null
}

/** meta.images of a multi-image group message; null when not multi-image (old messages and single images from older app versions still go through GroupMedia) */
export function groupAlbumOf(meta: Record<string, unknown> | undefined): GroupAlbumItem[] | null {
  const list = Array.isArray(meta?.images) ? (meta.images as GroupAlbumItem[]).filter((x) => x && typeof x.url === 'string').slice(0, 9) : []
  return list.length >= 2 ? list : null
}

/** Multi-image group message: grid. Thumbnails and full images both go through the local media cache */
export function GroupAlbum({ images }: { images: GroupAlbumItem[] }) {
  const items = useMemo<GridItem[]>(() => images.map((img) => {
    const video = img.kind === 'video'
    const full = absUrl(img.url, SOCIAL_API)
    const thumb = video ? full : absUrl(resolveImage(img).thumb || img.url, SOCIAL_API)
    return { key: img.url, kind: video ? 'video' : 'image', thumb: () => cachedMediaUrl(thumb).catch(() => thumb), full: () => cachedMediaUrl(full).catch(() => full) }
  }), [images])
  return <MediaGrid items={items} />
}

/** Multi-image DM: each image decrypted separately; grid uses thumbnails, full image decrypted on open */
function DmAlbum({ list }: { list: DmMedia[] }) {
  const items = useMemo<GridItem[]>(() => list.map((m) => ({
    key: m.url, kind: m.kind === 'video' ? 'video' : 'image',
    thumb: () => (m.kind === 'image' ? decryptThumbUrl(m) : decryptToUrl(m)),
    full: () => decryptToUrl(m),
  })), [list])
  return <MediaGrid items={items} />
}

/** DM media: rendered after decryption */
export function DmMediaBubble({ text, mine }: { text: string; mine: boolean }) {
  const m: DmMedia | null = parseDmMedia(text)
  const album = useMemo(() => { const p = parseDmMedia(text); const list = p ? dmMediaItems(p) : []; return list.length > 1 ? list : null }, [text])
  if (album) return <DmAlbum list={album} />
  return <DmSingle m={m} mine={mine} text={text} />
}

function DmSingle({ m, mine, text }: { m: DmMedia | null; mine: boolean; text: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  // Decrypt the thumbnail first (old messages without thumbnails decrypt the original), decrypt the full image on open
  useEffect(() => { if (!m) return; (m.kind === 'image' ? decryptThumbUrl(m) : decryptToUrl(m)).then(setUrl).catch(() => setErr(true)) }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null
  if (err) return <span className="text-xs opacity-70">{t('媒体已过期或无法解密')}</span>
  if (!url) return <span className="text-xs opacity-70">{t('解密中…')}</span>
  if (m.kind === 'image') return <ChatImage src={url} ratio={m.w && m.h ? m.w / m.h : undefined} loadFull={() => decryptToUrl(m)} />
  return <MediaView kind={m.kind} full={url} duration={m.duration} mine={mine} />
}
