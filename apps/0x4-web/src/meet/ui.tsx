// Small widgets for the meeting room (moved from meet/src/components into the app on 2026-09-29): dialogs, spinners, video, audio, participant tiles, device pre-check.
// Avatars use the app's own Avatar (address pixel avatar / NFT avatar — goat's call: no photo avatars); notices use the app's toast.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RemoteTrack, Track } from 'livekit-client'
import { Hand, Mic, MicOff, Minimize2, MonitorUp, ScanFace, Video, VideoOff, Volume2, X } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { t } from '@/lib/i18n'
import { listDevices, type PSnap } from './lk'
import { SCREEN_VIDEO_CLASS } from './AnnotationLayer'
import { fxActive, loadFx, saveFx } from '@/effects/settings'
import type { FxProcessor } from '@/effects/processor'
// These components use meet.css styles: imported here; the live room (Room.tsx) needs them too when showing the go-live check page (2026-10-02: previously only the meeting page imported it, leaving the live "Go Live" button unstyled/black)
import './meet.css'

export function Modal({ open, onClose, title, children, width = 440 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return <div className="meet-ui fixed inset-0 z-50 flex items-center justify-center bg-[var(--w-shade,rgb(0_0_0/.6))] p-6 meet-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal="true">
    <div className="meet-glass w-full rounded-[22px] bg-[var(--mt-panel)] p-6 shadow-[0_40px_120px_-20px_var(--mt-shadow),inset_0_0_0_1px_var(--mt-line)]" style={{ maxWidth: width }}>
      {title && <div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold tracking-tight">{title}</h2><button onClick={onClose} className="-mr-2 rounded-full p-2 text-muted hover:bg-[var(--mt-2)] hover:text-fg" aria-label={t('关闭')}><X size={18} /></button></div>}
      {children}
    </div>
  </div>
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-[var(--mt-4)] border-t-[color:var(--color-fg)]" style={{ width: size, height: size }} />
}

export function VideoView({ track, mirror, fit = 'cover', className = '' }: { track: Track; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  // Your own video is mirrored by default (like a mirror); with the 0x4 cat head on, no mirroring — otherwise the 0 and x on the cat's face flip (decided for live on 2026-10-02, same for meetings on 10-03)
  const flip = mirror && !catOn(track)
  return <video ref={ref} autoPlay playsInline muted className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${flip ? '-scale-x-100' : ''} ${className}`} />
}

/** This (local camera) track currently has the 0x4 effects processor attached, set to the cat head */
function catOn(track: Track): boolean {
  const p = (track as Track & { getProcessor?: () => { name?: string } | undefined }).getProcessor?.()
  return p?.name === '0x4-fx' && loadFx().avatar === 'cat'
}

/** Remote participants' audio: one hidden audio element per track */
export function AudioSink({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  return <audio ref={ref} autoPlay />
}

/** One participant's tile: video when available, avatar otherwise; name + mute badge at bottom-left; outline while speaking.
 * During screen share the main view is the screen; if this person has the camera on, it floats as a PiP at bottom-right (2026-09-30 goat: the camera used to vanish entirely during sharing),
 * and the PiP on the big view can be tapped to collapse / expand. overlay: things layered over the video (annotation layer) */
export function Tile({ p, hand, big, avatar, overlay }: { p: PSnap; hand?: boolean; big?: boolean; avatar?: string | null; overlay?: ReactNode }) {
  const track = p.screenTrack || p.camTrack
  const pip = !!p.screenTrack && !!p.camTrack
  const [pipOpen, setPipOpen] = useState(true)
  return <div className={`relative h-full w-full overflow-hidden rounded-[20px] bg-[var(--mt-tile)] transition-shadow ${p.speaking && p.mic ? 'meet-speaking' : 'shadow-[inset_0_0_0_1px_var(--mt-line)]'}`} data-testid="tile">
    {track
      ? <VideoView track={track} mirror={p.isLocal && !p.screenTrack} fit={p.screenTrack ? 'contain' : 'cover'} className={p.screenTrack ? SCREEN_VIDEO_CLASS : ''} />
      : <div className="flex h-full w-full items-center justify-center bg-[image:var(--mt-tile-grad)]">
        <Avatar address={p.id} src={avatar} name={p.name} size={big ? 112 : 68} />
      </div>}
    {overlay}
    {pip && (pipOpen || !big
      ? <div className={`absolute z-10 overflow-hidden rounded-[14px] bg-black shadow-[0_18px_40px_-12px_rgb(0_0_0/.85),0_0_0_1px_rgb(255_255_255/.14)] ${big ? 'bottom-4 right-4 aspect-video w-[220px] max-w-[34%]' : 'bottom-2 right-2 aspect-video w-[32%]'}`} data-testid="cam-pip">
        <VideoView track={p.camTrack!} mirror={p.isLocal} />
        {big && <>
          <span className="absolute bottom-1.5 left-2 max-w-[70%] truncate rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">{p.name}{p.isLocal ? ` (${t('你')})` : ''}</span>
          <button type="button" className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 hover:bg-black/75" onClick={(e) => { e.stopPropagation(); setPipOpen(false) }} aria-label={t('收起摄像头小窗')} title={t('收起摄像头小窗')}><Minimize2 size={13} /></button>
        </>}
      </div>
      : <button type="button" className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-medium text-white/90 shadow-lg hover:bg-black/75" onClick={(e) => { e.stopPropagation(); setPipOpen(true) }} data-testid="cam-pip-show"><Video size={13} />{t('显示摄像头')}</button>)}
    <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-24px)] items-center gap-1.5 rounded-full bg-black/55 py-1 pl-2.5 pr-3 text-[12.5px] font-medium text-white">
      {!p.mic && <MicOff size={13} className="shrink-0 text-[#ff6b76]" />}
      <span className="truncate">{p.name}{p.isLocal ? ` (${t('你')})` : ''}{p.screenTrack ? ` · ${t('正在共享')}` : ''}</span>
    </div>
    {hand && <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-[#ffc9a8] px-2.5 py-1 text-xs font-semibold text-[#1a1208]"><Hand size={13} />{t('举手')}</div>}
  </div>
}

// ---------- Screen-share permission (2026-09-30 goat: window / entire-screen options were unselectable — setting them did nothing) ----------
// Browsers don't allow pre-requesting screen-share permission — it can only pop at the moment sharing starts. On Mac, sharing a window or the entire screen additionally needs system permission:
// enable the browser in System Settings → Privacy & Security → Screen & System Audio Recording, then fully quit and relaunch the browser for it to take effect. Without it, browsers can still share tabs.
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)
/** Blocked by the OS (Chrome's exact words: Permission denied by system); the user dismissing it themselves is Permission denied */
export const deniedBySystem = (e: unknown) => e instanceof Error && e.name === 'NotAllowedError' && /system/i.test(e.message)
/** How to enable the OS screen-recording permission (Mac); this block is reused on the check page and on in-meeting share failures */
export function ScreenPermissionHelp() {
  return <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
    <li>{t('打开「系统设置」→「隐私与安全性」→「屏幕与系统录音」')}</li>
    <li>{t('把你正在用的浏览器（比如 Google Chrome）的开关打开')}</li>
    <li>{t('按 ⌘Q 彻底退出浏览器再重新打开，只关窗口不会生效')}</li>
  </ol>
}

// ---------- Pre-join device check ----------
export interface JoinPrefs { camOn: boolean; micOn: boolean; camId?: string; micId?: string; spkId?: string }
const PREF_KEY = '0x4.meet.devices'
function loadPrefs(): Partial<JoinPrefs> { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } catch { return {} } }

/** screenCheck: whether to include the "screen share" test row (meetings need it; live has no screen share — 2026-10-02 goat: hidden); tone="live": the start button uses live's red */
export function Precheck({ heading, sub, aside, joinLabel, joining, onJoin, camDefault = true, screenCheck = true, tone }: {
  heading: ReactNode; sub?: ReactNode; aside?: ReactNode; joinLabel: string; joining?: boolean; onJoin: (p: JoinPrefs) => void; camDefault?: boolean; screenCheck?: boolean; tone?: 'live'
}) {
  const saved = useRef(loadPrefs()).current
  const [camOn, setCamOn] = useState(saved.camOn ?? camDefault)
  const [micOn, setMicOn] = useState(saved.micOn ?? true)
  const [camId, setCamId] = useState(saved.camId)
  const [micId, setMicId] = useState(saved.micId)
  const [spkId, setSpkId] = useState(saved.spkId)
  const [devs, setDevs] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[]; spks: MediaDeviceInfo[] }>({ cams: [], mics: [], spks: [] })
  const [camErr, setCamErr] = useState<string | null>(null)
  const [micErr, setMicErr] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [loadingCam, setLoadingCam] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Avatar (2026-10-03 goat: meetings need the "faceless" option too): stored in the effects settings (shared with live); camera opens per it when joining / going live; the preview shows the processed feed directly
  const [avatar, setAvatar] = useState<'none' | 'cat'>(() => loadFx().avatar)
  const [fxErr, setFxErr] = useState<string | null>(null)
  const pickAvatar = (a: 'none' | 'cat') => { saveFx({ ...loadFx(), avatar: a }); setAvatar(a) }

  // Camera preview
  useEffect(() => {
    if (!camOn) { setCamErr(null); return }
    let stream: MediaStream | null = null, alive = true, proc: FxProcessor | null = null
    setLoadingCam(true); setFxErr(null)
    navigator.mediaDevices?.getUserMedia({ video: camId ? { deviceId: { exact: camId }, width: 1280, height: 720 } : { width: 1280, height: 720 } })
      .then(async (s) => {
        if (!alive) { s.getTracks().forEach((x) => x.stop()); return }
        stream = s; setCamErr(null)
        // With effects: the preview runs through the same processor (first run downloads the recognition model — a few seconds). When the virtual avatar fails to start, the preview never shows the real person, and the camera stays off after joining too
        const fx = loadFx()
        if (fxActive(fx)) {
          try {
            const { FxProcessor } = await import('@/effects/processor')
            const p = new FxProcessor(fx)
            await p.init({ kind: 'video' as Track.Kind.Video, track: s.getVideoTracks()[0] })
            if (!alive) { void p.destroy(); return }
            proc = p
            if (videoRef.current && p.processedTrack) videoRef.current.srcObject = new MediaStream([p.processedTrack])
          } catch {
            if (!alive) return
            setFxErr(fx.avatar === 'cat' ? t('这台电脑暂时用不了虚拟形象，进去以后摄像头会先关着') : t('特效没能打开，预览里是原画面'))
            if (videoRef.current && fx.avatar !== 'cat') videoRef.current.srcObject = s
          }
        } else if (videoRef.current) videoRef.current.srcObject = s
        setDevs(await listDevices())
      })
      .catch((e: Error) => { if (alive) setCamErr(e.name === 'NotAllowedError' ? t('浏览器没有允许使用摄像头') : t('没有找到可用的摄像头')) })
      .finally(() => { if (alive) setLoadingCam(false) })
    return () => { alive = false; void proc?.destroy(); stream?.getTracks().forEach((x) => x.stop()) }
  }, [camOn, camId, avatar])

  // Mic volume (capped at 30 fps; browsers auto-pause rAF when the page is hidden)
  useEffect(() => {
    if (!micOn) { setLevel(0); setMicErr(null); return }
    let stream: MediaStream | null = null, ctx: AudioContext | null = null, raf = 0, alive = true, last = 0
    navigator.mediaDevices?.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true })
      .then(async (s) => {
        if (!alive) { s.getTracks().forEach((x) => x.stop()); return }
        stream = s; setMicErr(null)
        ctx = new AudioContext()
        const an = ctx.createAnalyser(); an.fftSize = 512
        ctx.createMediaStreamSource(s).connect(an)
        const buf = new Uint8Array(an.fftSize)
        const tick = (now: number) => {
          raf = requestAnimationFrame(tick)
          if (now - last < 33) return
          last = now
          an.getByteTimeDomainData(buf)
          let sum = 0
          for (const v of buf) { const x = (v - 128) / 128; sum += x * x }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
        }
        raf = requestAnimationFrame(tick)
        setDevs(await listDevices())
      })
      .catch((e: Error) => { if (alive) setMicErr(e.name === 'NotAllowedError' ? t('浏览器没有允许使用麦克风') : t('没有找到可用的麦克风')) })
    return () => { alive = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((x) => x.stop()); void ctx?.close() }
  }, [micOn, micId])

  useEffect(() => { void listDevices().then(setDevs) }, [])

  // Screen-share dry run (2026-09-30): walks through browser + OS authorization before joining; on Mac without the OS permission it explains how to enable on the spot — no discovering it mid-meeting
  const [screen, setScreen] = useState<'idle' | 'testing' | 'ok' | 'tab' | 'system' | 'cancel' | 'unsupported'>('idle')
  const testScreen = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { setScreen('unsupported'); return }
    setScreen('testing')
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const surface = (s.getVideoTracks()[0]?.getSettings() as { displaySurface?: string }).displaySurface
      s.getTracks().forEach((x) => x.stop())
      // Tab selected: on Mac it's usually window / entire-screen being blocked by the OS — hint how to enable it
      setScreen(surface === 'browser' && isMac ? 'tab' : 'ok')
    } catch (e) {
      setScreen(deniedBySystem(e) ? 'system' : 'cancel')
    }
  }

  const join = () => {
    const p = { camOn: camOn && !camErr, micOn: micOn && !micErr, camId, micId, spkId }
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ camOn, micOn, camId, micId, spkId })) } catch { /* Ignored */ }
    onJoin(p)
  }
  const testSpeaker = () => {
    const ctx = new AudioContext()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = 660; g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6)
    o.connect(g).connect(ctx.destination)
    const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    void (spkId && sink.setSinkId ? sink.setSinkId(spkId).catch(() => {}) : Promise.resolve()).then(() => { o.start(); o.stop(ctx.currentTime + 0.65); setTimeout(() => void ctx.close(), 900) })
  }

  const bars = 18
  return <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 items-center gap-10 px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14 lg:px-10">
    <div className="meet-fade">
      <div className="relative aspect-video w-full overflow-hidden rounded-[28px] bg-[var(--mt-surface)] shadow-[0_40px_100px_-30px_var(--mt-shadow),inset_0_0_0_1px_var(--mt-line)]" data-testid="preview">
        {/* Preview mirrored (like a mirror); with the cat head selected and the processor running, no mirroring — otherwise the text on the cat's face flips */}
        {camOn && !camErr && <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${avatar === 'cat' && !fxErr ? '' : '-scale-x-100'}`} />}
        {(!camOn || camErr) && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
          <VideoOff size={30} strokeWidth={1.6} />
          <span className="text-sm">{camErr || t('摄像头已关闭')}</span>
        </div>}
        {camOn && loadingCam && !camErr && <div className="absolute inset-0 flex items-center justify-center"><Spinner size={22} /></div>}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent pb-5 pt-14">
          <button className="meet-ctl meet-tip" data-off={!micOn || !!micErr} data-tip={micOn ? t('关闭麦克风') : t('开启麦克风')} onClick={() => setMicOn((v) => !v)} aria-label={t('麦克风')}>{micOn && !micErr ? <Mic size={20} /> : <MicOff size={20} />}</button>
          <button className="meet-ctl meet-tip" data-off={!camOn || !!camErr} data-tip={camOn ? t('关闭摄像头') : t('开启摄像头')} onClick={() => setCamOn((v) => !v)} aria-label={t('摄像头')}>{camOn && !camErr ? <Video size={20} /> : <VideoOff size={20} />}</button>
        </div>
        {micOn && !micErr && <div className="absolute left-5 top-5 flex h-8 items-center gap-[3px] rounded-full bg-black/50 px-3" aria-label={t('麦克风音量')} data-testid="mic-level">
          <Mic size={13} className="mr-1.5 text-muted" />
          {Array.from({ length: bars }, (_, i) => <span key={i} className="w-[3px] rounded-full transition-[height,background-color] duration-75" style={{ height: 4 + (i / bars < level ? 12 : 0), background: i / bars < level ? 'linear-gradient(#8fe0ff,#cdbdff)' : 'rgb(255 255 255 / .18)' }} />)}
        </div>}
      </div>
      {fxErr && <p className="mt-3 rounded-xl bg-[#ff6b76]/12 px-3 py-2 text-[12.5px] text-[#ff9aa2]" role="status">{fxErr}</p>}
      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-[var(--mt-1)] px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--mt-3)]">
        <span className="flex items-center gap-2 text-[13px]"><ScanFace size={15} className="text-muted" />{t('形象')}</span>
        <div className="flex gap-1 rounded-full bg-[var(--mt-2)] p-1" role="radiogroup" aria-label={t('虚拟形象')}>
          <button type="button" role="radio" aria-checked={avatar === 'none'} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${avatar === 'none' ? 'bg-[var(--mt-4)] text-fg' : 'text-muted hover:text-fg'}`} onClick={() => pickAvatar('none')}>{t('真人')}</button>
          <button type="button" role="radio" aria-checked={avatar === 'cat'} className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${avatar === 'cat' ? 'bg-[var(--mt-4)] text-fg' : 'text-muted hover:text-fg'}`} onClick={() => pickAvatar('cat')} data-testid="pre-avatar-cat"><img src={`${import.meta.env.BASE_URL}icons/cat.svg`} alt="" width={15} height={15} />{t('不露脸（0x4 猫头）')}</button>
        </div>
      </div>
      {/* One device per row (2026-10-02 goat: three side-by-side squeezed long device names together) */}
      <div className="mt-3 grid grid-cols-1 gap-2">
        <DeviceSelect icon={<Video size={15} />} label={t('摄像头')} list={devs.cams} value={camId} onChange={setCamId} />
        <DeviceSelect icon={<Mic size={15} />} label={t('麦克风')} list={devs.mics} value={micId} onChange={setMicId} error={micErr} />
        <DeviceSelect icon={<Volume2 size={15} />} label={t('扬声器')} list={devs.spks} value={spkId} onChange={setSpkId} action={<button className="text-[11px] font-medium text-accent hover:underline" onClick={testSpeaker}>{t('测试')}</button>} />
      </div>
      {screenCheck && <div className="mt-3 rounded-2xl bg-[var(--mt-1)] px-4 py-3" data-testid="screen-check">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[13px]"><MonitorUp size={15} className="text-muted" />{t('屏幕共享')}
            <span className="text-[12px] text-muted">{screen === 'ok' ? t('可以共享') : screen === 'tab' ? t('只选到了标签页') : screen === 'system' ? t('被系统拦下了') : screen === 'cancel' ? t('没有完成测试') : screen === 'unsupported' ? t('这个浏览器不支持') : ''}</span></span>
          {screen !== 'unsupported' && <button className="shrink-0 text-[12px] font-medium text-accent hover:underline disabled:opacity-50" disabled={screen === 'testing'} onClick={() => void testScreen()}>{screen === 'testing' ? t('等待选择…') : t('测试共享')}</button>}
        </div>
        {(screen === 'system' || screen === 'tab' || (isMac && screen === 'idle')) && <div className="mt-2.5">
          <p className="mb-1.5 text-[12.5px] text-muted">{screen === 'idle' ? t('Mac 上要共享窗口或整个屏幕，需要先在系统里给浏览器屏幕录制权限：') : t('要共享窗口或整个屏幕，请先打开系统权限：')}</p>
          <ScreenPermissionHelp />
        </div>}
      </div>}
    </div>

    <div className="meet-fade flex flex-col items-start" style={{ animationDelay: '.06s' }}>
      <div className="w-full">{heading}</div>
      {sub && <div className="mt-3 w-full text-[15px] text-muted">{sub}</div>}
      <button className={`meet-btn ${tone === 'live' ? 'meet-btn-live' : 'meet-btn-primary'} mt-9 h-12 min-w-[180px] px-7 text-[15px]`} disabled={joining} onClick={join} data-testid="join">{joining ? <Spinner size={16} /> : joinLabel}</button>
      {aside && <div className="mt-8 w-full">{aside}</div>}
    </div>
  </div>
}

/** Strip useless parts from device names: USB ids like "(05ac:8514)", the "Default - " prefixes (all locales) */
export function deviceName(label: string): string {
  return label.replace(/^(default|\u9ed8\u8ba4|communications|\u901a\u4fe1)\s*[-–]\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
}

function DeviceSelect({ icon, label, list, value, onChange, error, action }: { icon: ReactNode; label: string; list: MediaDeviceInfo[]; value?: string; onChange: (v: string) => void; error?: string | null; action?: ReactNode }) {
  // One row: icon + name (fixed width) on the left, a full-width dropdown in the middle, optional "test" on the right
  return <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3">
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted">{icon}{label}</span>
    <select className="meet-input meet-select h-10 min-w-0 truncate text-[13px]" value={value || list[0]?.deviceId || ''} onChange={(e) => onChange(e.target.value)} disabled={!list.length} aria-label={label}>
      {!list.length && <option value="">{error || t('系统默认')}</option>}
      {list.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{deviceName(d.label) || `${label} ${i + 1}`}</option>)}
    </select>
    <span className="w-8 text-right">{action}</span>
  </div>
}

/** Call timer 00:00 / 1:02:03 */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
