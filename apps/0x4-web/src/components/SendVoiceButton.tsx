// Send key doubling as voice key: tap to send; hold past HOLD_TO_RECORD_MS to record; release to send the voice message; sliding off the button before release cancels.
// Touch and mouse both go through pointer events; setPointerCapture on press so the release is still received when the finger slides off the button.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Mic } from 'lucide-react'
import { toast } from './Toast'
import { t } from '@/lib/i18n'
import { tap } from '@/lib/native'
import { checkVoice, HOLD_TO_RECORD_MS, pickVoiceMime, VOICE_MAX_SECONDS } from '@/lib/voice'

type Phase = 'idle' | 'pressing' | 'starting' | 'recording'
/** How many px beyond the button a release still counts as "on the button" */
const SLOP = 24

interface Props {
  /** There's content to send (input non-empty); a tap does nothing when false */
  canSend: boolean
  onSend: () => void
  onVoice: (blob: Blob, seconds: number) => void
  /** Recording new voice is disallowed while an upload is in progress */
  voiceDisabled?: boolean
  className?: string
  children: ReactNode
}

export default function SendVoiceButton({ canSend, onSend, onVoice, voiceDisabled, className = '', children }: Props) {
  const btn = useRef<HTMLButtonElement>(null)
  const ring = useRef<HTMLSpanElement>(null)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const phaseRef = useRef<Phase>('idle')
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p) }
  const [outside, setOutsideState] = useState(false)
  const outsideRef = useRef(false)
  const setOutside = (v: boolean) => { if (outsideRef.current !== v) { outsideRef.current = v; setOutsideState(v) } }
  const [secs, setSecs] = useState(0)

  const holdTimer = useRef(0)
  const tickTimer = useRef(0)
  const released = useRef(false)
  const rec = useRef<MediaRecorder | null>(null)
  const recChunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)
  // Callbacks may change mid-recording (input content etc.) — grab the latest via ref
  const latest = useRef({ canSend, onSend, onVoice, voiceDisabled })
  latest.current = { canSend, onSend, onVoice, voiceDisabled }

  const releaseMic = () => { stream.current?.getTracks().forEach((tr) => tr.stop()); stream.current = null }
  const clearTimers = () => { window.clearTimeout(holdTimer.current); window.clearInterval(tickTimer.current) }

  /** End the recording; discarded when send=false */
  const finish = (send: boolean) => {
    clearTimers()
    const r = rec.current
    const chunks = recChunks.current
    const st = stream.current
    const seconds = (Date.now() - startedAt.current) / 1000
    rec.current = null; stream.current = null
    setPhase('idle'); setOutside(false)
    const stopMic = () => st?.getTracks().forEach((tr) => tr.stop())
    if (!r || r.state === 'inactive') { stopMic(); return }
    r.onstop = () => {
      // Release the mic before processing, so playback can return to normal speaker output
      stopMic()
      if (!send) return
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/mp4' })
      const c = checkVoice(blob.size, seconds)
      if (c === 'short') toast.error(t('太短了，按住再说'))
      else if (c === 'silent') toast.error(t('没有录到声音，请检查麦克风是否可用或被静音'))
      else latest.current.onVoice(blob, seconds)
    }
    r.stop()
  }

  const beginRecording = async () => {
    if (phaseRef.current !== 'pressing') return
    if (latest.current.voiceDisabled) { setPhase('idle'); toast.info(t('正在上传')); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setPhase('idle'); toast.error(t('当前设备不支持录音')); return }
    setPhase('starting'); tap()
    // phaseRef may be mutated by pointer events or unmount during the wait — read the latest via a function (also sidesteps TS narrowing)
    const stillStarting = () => phaseRef.current === 'starting'
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      if (stillStarting()) { setPhase('idle'); setOutside(false); toast.error(t('没有麦克风权限')) }
      return
    }
    // The first time pops the OS permission dialog and the finger is usually gone by then; same when the component unmounts — just release the mic
    if (released.current || !stillStarting()) {
      s.getTracks().forEach((tr) => tr.stop())
      if (stillStarting()) {
        const movedOut = outsideRef.current
        setPhase('idle'); setOutside(false)
        if (!movedOut) toast.info(t('按住不放，看到计时再松开'))
      }
      return
    }
    stream.current = s
    const mime = pickVoiceMime((m) => MediaRecorder.isTypeSupported(m))
    let r: MediaRecorder
    try {
      r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48_000 })
    } catch {
      releaseMic(); setPhase('idle'); toast.error(t('当前设备不支持录音')); return
    }
    const chunks: Blob[] = []
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.current = r; recChunks.current = chunks
    r.start(1000)
    startedAt.current = Date.now()
    setSecs(0); setPhase('recording'); tap()
    tickTimer.current = window.setInterval(() => {
      const sec = (Date.now() - startedAt.current) / 1000
      setSecs(Math.floor(sec))
      if (sec >= VOICE_MAX_SECONDS && rec.current === r) finish(!outsideRef.current)
    }, 250)
  }

  const isOutside = (x: number, y: number) => {
    const b = btn.current?.getBoundingClientRect()
    if (!b) return false
    return x < b.left - SLOP || x > b.right + SLOP || y < b.top - SLOP || y > b.bottom + SLOP
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (phaseRef.current !== 'idle') return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* Unsupported in some environments */ }
    released.current = false
    setOutside(false)
    setPhase('pressing')
    holdTimer.current = window.setTimeout(beginRecording, HOLD_TO_RECORD_MS)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = phaseRef.current
    if (p === 'idle') return
    const out = isOutside(e.clientX, e.clientY)
    // Slid away before recording started: treat as abandoning this press
    if (p === 'pressing' && out) { clearTimers(); setPhase('idle'); return }
    if (p === 'starting' || p === 'recording') setOutside(out)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = phaseRef.current
    const out = isOutside(e.clientX, e.clientY)
    if (p === 'pressing') {
      clearTimers(); setPhase('idle')
      if (!out && latest.current.canSend) latest.current.onSend()
    } else if (p === 'starting') {
      released.current = true
      setOutside(out)
    } else if (p === 'recording') {
      finish(!out)
    }
  }
  const onPointerCancel = () => {
    const p = phaseRef.current
    if (p === 'pressing') { clearTimers(); setPhase('idle') }
    else if (p === 'starting') released.current = true
    else if (p === 'recording') finish(false)
  }

  // No progress shown during the first 250 ms of holding, so every tap doesn't flash
  useEffect(() => {
    if (phase !== 'pressing' || !ring.current?.animate) return
    const a = ring.current.animate([{ transform: 'scale(0)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 0.55 }], { duration: HOLD_TO_RECORD_MS - 250, delay: 250, easing: 'linear', fill: 'forwards' })
    return () => a.cancel()
  }, [phase])

  // Discard the in-progress recording and release the mic when leaving the page
  useEffect(() => () => {
    window.clearTimeout(holdTimer.current); window.clearInterval(tickTimer.current)
    phaseRef.current = 'idle'
    const r = rec.current; rec.current = null
    if (r && r.state !== 'inactive') { r.onstop = null; try { r.stop() } catch { /* ignore */ } }
    stream.current?.getTracks().forEach((tr) => tr.stop()); stream.current = null
  }, [])

  const live = phase === 'starting' || phase === 'recording'
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0')
  return (
    <>
      <button
        ref={btn}
        type="button"
        data-swipe-back="off"
        aria-label={t('发送')}
        title={t('按住说话')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        // Keyboard-triggered clicks (Enter / Space) have no pointer events, detail is 0; pointer clicks are already handled in pointerup
        onClick={(e) => { if (e.detail === 0 && canSend) onSend() }}
        className={`${className} relative select-none overflow-visible ${live ? (outside ? '!bg-card2 !text-down' : '!bg-down !text-white') : ''} ${!canSend && !live ? 'opacity-50' : ''}`}
        style={{
          touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
          transform: live ? 'scale(1.3)' : undefined, transition: 'transform 160ms ease, background-color 160ms ease',
        }}
      >
        {phase === 'pressing' && <span ref={ring} aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-down" style={{ transform: 'scale(0)', opacity: 0 }} />}
        <span className="relative flex items-center justify-center">{live ? <Mic size={19} /> : children}</span>
      </button>
      {live && createPortal(
        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-1/3 z-[100] flex justify-center px-4">
          <div className={`flex min-w-40 flex-col items-center gap-1.5 rounded-2xl px-6 py-4 text-center shadow-lg ${outside ? 'bg-down text-white' : 'bg-card text-fg'}`}>
            <span className={`flex h-12 w-12 items-center justify-center rounded-full ${outside ? 'bg-white/20' : 'bg-down/15 text-down'}`}><Mic size={24} className={phase === 'recording' && !outside ? 'animate-pulse' : ''} /></span>
            <span className="text-lg font-semibold tabular-nums">{mm}:{ss}</span>
            <span className="text-xs opacity-80">{outside ? t('松开取消') : t('松开发送，上滑取消')}</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
