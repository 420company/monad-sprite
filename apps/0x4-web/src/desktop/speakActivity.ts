// 在会议 / 直播里自己正在说话，算「在用」（2026-10-01 goat：公共电脑扫码登录后，专门来开会讲话的人不该被当成没人）。
// 只看 LiveKit 本地给的「正在说话」标记（它按麦克风音量判断），不录音、不上传任何声音。说话期间每 20 秒报一次（qrIdle 那边一分钟最多告诉服务器一次）。
// 只是开着麦、开着页面听，不算。
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
