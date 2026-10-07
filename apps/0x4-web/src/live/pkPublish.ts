// During PK, the streamer pushes their camera and mic into the opponent's live room simultaneously (2026-09-30, see docs/LIVE_PK_PLAN.md section 4).
// The token is issued by the server to the streamer only (identity pk:<account> — publish only, no viewing); both sides' viewers connect only to their own room, yet see both streamers.
// What's pushed is a clone of the local tracks: the clone is closed when the PK ends, leaving the streamer's own room feed untouched.
import { useEffect } from 'react'
import type { Room as LKRoom } from 'livekit-client'
import type { PkLink } from './pk'

export function usePkPublish(link: PkLink | null, mainRoom: LKRoom | null, media: { mic: boolean; cam: boolean }) {
  useEffect(() => {
    if (!link || !mainRoom) return
    let alive = true
    let room: LKRoom | null = null
    const clones: MediaStreamTrack[] = []
    void (async () => {
      const sdk = await import('livekit-client').catch(() => null)
      if (!sdk || !alive) return
      room = new sdk.Room({ adaptiveStream: false, dynacast: true })
      try {
        await room.connect(link.url, link.token, { autoSubscribe: false })
        if (!alive) { void room.disconnect(); return }
        for (const pub of mainRoom.localParticipant.trackPublications.values()) {
          const tr = pub.track?.mediaStreamTrack
          if (!tr || pub.isMuted) continue
          const c = tr.clone()
          clones.push(c)
          await room.localParticipant.publishTrack(c, { source: pub.source, name: pub.trackName })
        }
      } catch (e) { console.warn('[pk] 推进对面房间失败', e) }
    })()
    return () => { alive = false; void room?.disconnect(); for (const c of clones) c.stop() }
  }, [link?.pkId, link?.token, mainRoom, media.mic, media.cam]) // eslint-disable-line react-hooks/exhaustive-deps
}
