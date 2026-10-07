// Speaking myself in a meeting / livestream counts as "in use" (2026-10-01 goat: after scan-logging into a public computer, someone who came specifically to speak shouldn't count as absent).
// Only looks at LiveKit's local "speaking" flag (it judges by mic volume) — no recording, no audio uploaded. Reports every 20s while speaking (qrIdle tells the server at most once per minute).
// Just having the mic on and listening on the page doesn't count.
import { ParticipantEvent, type Room } from 'livekit-client'
import { reportActivity } from './qrIdle'

export function watchSpeaking(room: Room | null | undefined): (() => void) | undefined {
  if (!room) return undefined
  const lp = room.localParticipant
  const onSpeak = (speaking: boolean) => { if (speaking) reportActivity('speak') }
  lp.on(ParticipantEvent.IsSpeakingChanged, onSpeak)
  const iv = setInterval(() => { if (lp.isSpeaking) reportActivity('speak') }, 20_000)
  return () => { lp.off(ParticipantEvent.IsSpeakingChanged, onSpeak); clearInterval(iv) }
}
