// Livestream effects switch (2026-10-02): applies settings to the host's camera.
// · When the camera opens: processorForCamera() returns a processor already configured per settings (none when effects are off) — frames are processed from the very start.
// · Changing settings mid-stream: applyFx(track, settings) — if already processing, only params change; going from "all off" to "effects on" attaches the processor; turning everything off detaches it.
// · The processor code (incl. detection engine, three.js) loads on demand — hosts without effects and viewers never load it.
import type { LocalVideoTrack } from 'livekit-client'
import { fxActive, loadFx, type FxSettings } from './settings'
import type { FxProcessor, FxStatus } from './processor'

let current: FxProcessor | null = null
const listeners = new Set<(s: FxStatus) => void>()
export function onFxStatus(fn: (s: FxStatus) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
const emit = (s: FxStatus) => listeners.forEach((fn) => fn(s))

async function make(s: FxSettings): Promise<FxProcessor> {
  const { FxProcessor } = await import('./processor')
  const p = new FxProcessor(s)
  p.onStatus = emit
  current = p
  return p
}

/** Attached when the camera opens: returns the processor if the locally saved settings have effects, undefined otherwise */
export async function processorForCamera(): Promise<FxProcessor | undefined> {
  const s = loadFx()
  return fxActive(s) ? make(s) : undefined
}

/** Change settings mid-stream */
export async function applyFx(track: LocalVideoTrack | undefined, s: FxSettings) {
  if (!track) return
  const p = track.getProcessor() as FxProcessor | undefined
  if (fxActive(s)) {
    if (p && p === current) { p.update(s); return }
    await track.setProcessor(await make(s))
  } else if (p) {
    await track.stopProcessor()
    current = null
  }
}

export const fxStatus = (): FxStatus | null => current?.status ?? null
