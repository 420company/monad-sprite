// Thin wrapper around the meeting A/V connection (moved from meet/src/lib/lk.ts into the app on 2026-09-29; for meetings in the web "Streaming" section): one Room + a participant snapshot.
// Modeled on the main app's Room.tsx: every room event triggers a snapshot rebuild, and the page renders from the snapshot.
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, ConnectionState, type Participant, type RemoteTrack } from 'livekit-client'
import type { AnnMsg } from './annotate'

export interface PSnap {
  id: string; name: string; isLocal: boolean
  mic: boolean; cam: boolean; screen: boolean; speaking: boolean
  camTrack?: Track; screenTrack?: Track; audioTrack?: RemoteTrack
  joinedAt: number
}

function snap(p: Participant, isLocal: boolean): PSnap {
  const cam = p.getTrackPublication(Track.Source.Camera)
  const scr = p.getTrackPublication(Track.Source.ScreenShare)
  const mic = p.getTrackPublication(Track.Source.Microphone)
  return {
    id: p.identity, name: p.name || p.identity, isLocal,
    mic: !!mic && !mic.isMuted, cam: !!cam?.track && !cam.isMuted, screen: !!scr?.track && !scr.isMuted, speaking: p.isSpeaking,
    camTrack: cam?.track && !cam.isMuted ? cam.track : undefined,
    screenTrack: scr?.track && !scr.isMuted ? scr.track : undefined,
    audioTrack: !isLocal && mic?.track ? (mic.track as RemoteTrack) : undefined,
    joinedAt: p.joinedAt?.getTime() || Date.now(),
  }
}

export type LkState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'

export function useLkRoom() {
  const roomRef = useRef<Room | null>(null)
  // Echo cancellation hardcoded on: gift sound effects (like the hakimi meme sound) played on the streamer's side won't be re-captured by the mic and doubled to viewers
  if (!roomRef.current) roomRef.current = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const room = roomRef.current
  const [parts, setParts] = useState<PSnap[]>([])
  const [state, setState] = useState<LkState>('idle')
  const [audioBlocked, setAudioBlocked] = useState(false)

  useEffect(() => {
    const update = () => setParts([snap(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => snap(p, false))])
    const evs = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantNameChanged, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished] as const
    for (const e of evs) room.on(e, update)
    const onState = (s: ConnectionState) => {
      setState(s === ConnectionState.Connected ? 'connected' : s === ConnectionState.Connecting ? 'connecting' : s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting ? 'reconnecting' : 'disconnected')
      update()
    }
    const onAudio = () => setAudioBlocked(!room.canPlaybackAudio)
    room.on(RoomEvent.ConnectionStateChanged, onState)
    room.on(RoomEvent.AudioPlaybackStatusChanged, onAudio)
    return () => {
      for (const e of evs) room.off(e, update)
      room.off(RoomEvent.ConnectionStateChanged, onState)
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudio)
    }
  }, [room])

  // Always disconnect when leaving the page (camera light off)
  useEffect(() => () => { void room.disconnect() }, [room])

  const connect = async (url: string, token: string) => {
    setState('connecting')
    try {
      await room.connect(url, token)
      setAudioBlocked(!room.canPlaybackAudio)
      setParts([snap(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => snap(p, false))])
      setState('connected')
      return true
    } catch { setState('failed'); return false }
  }
  const refresh = () => setParts([snap(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => snap(p, false))])
  return { room, parts, state, audioBlocked, connect, refresh, startAudio: () => room.startAudio().then(() => setAudioBlocked(false)) }
}

/** Data messages (chat / hand-raise / reactions / annotations): travel over the LiveKit data channel in meetings — not our WebSocket */
export type MeetData = { t: 'chat'; text: string; id: string } | { t: 'hand'; up: boolean } | { t: 'react'; emoji: string } | { t: 'end' } | AnnMsg
const enc = new TextEncoder(), dec = new TextDecoder()
export const packData = (d: MeetData) => enc.encode(JSON.stringify(d))
export function unpackData(b: Uint8Array): MeetData | null {
  try { const d = JSON.parse(dec.decode(b)) as MeetData; return d && typeof d === 'object' && 't' in d ? d : null } catch { return null }
}

/** Device list (labels are empty before authorization, so re-read after media permission is granted) */
export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
  return { cams: all.filter((d) => d.kind === 'videoinput'), mics: all.filter((d) => d.kind === 'audioinput'), spks: all.filter((d) => d.kind === 'audiooutput') }
}
