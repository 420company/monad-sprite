// 图片 / 视频 / 语音消息渲染；语音是自绘播放器（时长 + 进度）
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

/** 正在播放的那条语音 */
let current: HTMLAudioElement | null = null

export function VoicePlayer({ src, duration, mine }: { src: string; duration?: number; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const dur = duration || audio.current?.duration || 0
  const toggle = () => {
    const a = audio.current; if (!a) return
    if (playing) { a.pause(); setPlaying(false); return }
    // 同一时间只放一条；上一次加载失败的重新加载一遍；确保没被静音、音量是满的
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

/** 群消息媒体（明文 URL）。看过的缓存在本机，服务器上的文件过期后照样能看 */
export function GroupMedia({ kind, url, duration, mine }: { kind: string; url: string; duration?: number; mine?: boolean }) {
  // 图片在气泡里只拉缩略图（新上传的文件名里带缩略图地址和宽高），点开再看大图
  const img = kind === 'image' ? resolveImage({ url }) : null
  const remote = absUrl(img?.thumb || url, SOCIAL_API)
  const [local, setLocal] = useState<string | null>(remote.startsWith('blob:') ? remote : null)
  useEffect(() => {
    if (remote.startsWith('blob:')) { setLocal(remote); return }
    let alive = true
    setLocal(null)
    // 缓存和下载都不行（没网、跨域）就退回直接用原地址
    cachedMediaUrl(remote).then((u) => { if (alive) setLocal(u) }).catch(() => { if (alive) setLocal(remote) })
    return () => { alive = false }
  }, [remote])
  if (!local && img?.w && img.h) return <div data-chat-image className="max-w-full animate-pulse rounded-xl bg-card2" style={chatImageBox(img.w / img.h)} aria-label={t('加载中…')} />
  if (!local) return kind === 'voice' ? <span className="text-xs opacity-70">{t('加载中…')}</span> : <div className="h-32 w-44 max-w-full animate-pulse rounded-xl bg-card2" aria-label={t('加载中…')} />
  if (img) return <ChatImage src={local} ratio={img.w && img.h ? img.w / img.h : undefined} loadFull={() => cachedMediaUrl(absUrl(url, SOCIAL_API)).catch(() => absUrl(url, SOCIAL_API))} />
  return <MediaView kind={kind} full={local} href={remote} duration={duration} mine={mine} />
}

/** 按比例占位：高最多 320、宽最多 240（群聊气泡没设 max-w，靠百分比压不住，只能给定宽），特别细长的裁到 1:3 ~ 3:1 */
const CHAT_IMAGE_MAX_W = 240
const chatImageBox = (ratio: number) => { const r = Math.min(3, Math.max(1 / 3, ratio)); return { aspectRatio: String(r), width: `${Math.round(Math.min(320 * r, CHAT_IMAGE_MAX_W))}px`, maxWidth: '100%' } }

/** 聊天里的图片：不套气泡底色，直接显示，12px 圆角，按比例、最高 320；点开全屏看大图 */
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

/** 群多图消息的 meta.images；不是多图消息返回 null（老消息、旧版 App 发的单张照旧走 GroupMedia） */
export function groupAlbumOf(meta: Record<string, unknown> | undefined): GroupAlbumItem[] | null {
  const list = Array.isArray(meta?.images) ? (meta.images as GroupAlbumItem[]).filter((x) => x && typeof x.url === 'string').slice(0, 9) : []
  return list.length >= 2 ? list : null
}

/** 群多图消息：宫格。缩略图和大图都走本机媒体缓存 */
export function GroupAlbum({ images }: { images: GroupAlbumItem[] }) {
  const items = useMemo<GridItem[]>(() => images.map((img) => {
    const video = img.kind === 'video'
    const full = absUrl(img.url, SOCIAL_API)
    const thumb = video ? full : absUrl(resolveImage(img).thumb || img.url, SOCIAL_API)
    return { key: img.url, kind: video ? 'video' : 'image', thumb: () => cachedMediaUrl(thumb).catch(() => thumb), full: () => cachedMediaUrl(full).catch(() => full) }
  }), [images])
  return <MediaGrid items={items} />
}

/** 私信多图消息：每张各自解密；格子里用缩略图，点开再解大图 */
function DmAlbum({ list }: { list: DmMedia[] }) {
  const items = useMemo<GridItem[]>(() => list.map((m) => ({
    key: m.url, kind: m.kind === 'video' ? 'video' : 'image',
    thumb: () => (m.kind === 'image' ? decryptThumbUrl(m) : decryptToUrl(m)),
    full: () => decryptToUrl(m),
  })), [list])
  return <MediaGrid items={items} />
}

/** 私信媒体：解密后渲染 */
export function DmMediaBubble({ text, mine }: { text: string; mine: boolean }) {
  const m: DmMedia | null = parseDmMedia(text)
  const album = useMemo(() => { const p = parseDmMedia(text); const list = p ? dmMediaItems(p) : []; return list.length > 1 ? list : null }, [text])
  if (album) return <DmAlbum list={album} />
  return <DmSingle m={m} mine={mine} text={text} />
}

function DmSingle({ m, mine, text }: { m: DmMedia | null; mine: boolean; text: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  // 图片先解缩略图（老消息没有缩略图就解原图），点开再解大图
  useEffect(() => { if (!m) return; (m.kind === 'image' ? decryptThumbUrl(m) : decryptToUrl(m)).then(setUrl).catch(() => setErr(true)) }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null
  if (err) return <span className="text-xs opacity-70">{t('媒体已过期或无法解密')}</span>
  if (!url) return <span className="text-xs opacity-70">{t('解密中…')}</span>
  if (m.kind === 'image') return <ChatImage src={url} ratio={m.w && m.h ? m.w / m.h : undefined} loadFull={() => decryptToUrl(m)} />
  return <MediaView kind={m.kind} full={url} duration={m.duration} mine={mine} />
}
