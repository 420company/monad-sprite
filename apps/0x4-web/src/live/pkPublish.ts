// PK 时主播把自己的摄像头和麦克风同时推进对面的直播间（2026-09-30，见 docs/LIVE_PK_PLAN.md 第四节）。
// 令牌由服务器只发给主播本人（身份 pk:<账号>，只推不看）；两边观众都只连自己房间，就能同时看到两个主播。
// 推的是本机轨道的副本（clone）：连线结束时关掉副本，不影响自己房间里那一路。
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
