// Call ringtones: synthesized live with WebAudio, no audio files.
//   incoming ring: two short dual-tones (like a phone ring), one round every 2.4s
//   ringback: while the caller waits, 1s long tone then 3s pause (domestic ringback 450Hz)
//
// iOS / some browsers require the AudioContext to be created or resumed inside a user tap, but incoming calls usually come with no tap,
// so the context is unlocked on the first touch — later incoming calls ring right away. When unlocking fails, vibrate only.
let ctx: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | null = null
let master: GainNode | null = null

function context(): AudioContext | null {
  if (ctx) return ctx
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try { ctx = new AC() } catch { return null }
  return ctx
}

/** Hook once: the next first touch unlocks audio as a side effect */
export function primeRingtone(): void {
  if (typeof window === 'undefined') return
  const unlock = () => { const c = context(); if (c && c.state === 'suspended') void c.resume().catch(() => {}) }
  window.addEventListener('pointerdown', unlock, { once: true, capture: true })
}

function beep(c: AudioContext, out: AudioNode, freqs: number[], start: number, dur: number, vol: number) {
  const g = c.createGain()
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(vol, start + 0.02)
  g.gain.setValueAtTime(vol, start + dur - 0.04)
  g.gain.linearRampToValueAtTime(0, start + dur)
  g.connect(out)
  for (const f of freqs) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    o.connect(g)
    o.start(start)
    o.stop(start + dur + 0.02)
  }
}

export function stopRingtone(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (master) { try { master.disconnect() } catch { /* ignore */ } master = null }
}

export function playRingtone(kind: 'ring' | 'ringback'): void {
  stopRingtone()
  const c = context()
  if (!c) return
  if (c.state === 'suspended') void c.resume().catch(() => {})
  const out = c.createGain()
  out.connect(c.destination)
  master = out
  const round = () => {
    const now = c.currentTime + 0.05
    if (kind === 'ring') {
      beep(c, out, [880, 1318.5], now, 0.18, 0.16)
      beep(c, out, [880, 1318.5], now + 0.26, 0.18, 0.16)
      beep(c, out, [1046.5, 1568], now + 0.52, 0.28, 0.14)
    } else {
      beep(c, out, [450], now, 1, 0.12)
    }
  }
  round()
  timer = setInterval(round, kind === 'ring' ? 2400 : 4000)
}
