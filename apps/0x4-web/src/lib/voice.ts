// 语音消息的录音格式与校验。
//
// 录音格式顺序要把 AAC（audio/mp4）放在 WebM 前面：
// iOS 18.4 起 WKWebView 的 MediaRecorder 也支持 audio/webm;codecs=opus 了，
// 以前 WebM 排第一，iOS 老版本不支持所以落到 mp4、能播；系统升级后 iOS 改录 WebM，
// 而 WebKit 自己录出来的 WebM（流式写入，没有时长和索引）在 iOS 的 <audio> 里播放不可靠。
// AAC/MP4 是 iOS 原生格式，安卓和桌面浏览器也都能播。
// 桌面 Chrome 不支持 AAC 编码时退回 WebM；纯 audio/mp4 在 Chrome 里是 Opus 装 MP4，放到最后。
export const VOICE_MIME_PREFERENCE = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export function pickVoiceMime(isSupported: (t: string) => boolean): string {
  for (const t of VOICE_MIME_PREFERENCE) {
    try { if (isSupported(t)) return t } catch { /* 个别浏览器对不认识的类型直接抛错 */ }
  }
  return ''
}

/** 按住发送键多久进入录音（毫秒） */
export const HOLD_TO_RECORD_MS = 2000
/** 单条语音最长秒数 */
export const VOICE_MAX_SECONDS = 60

export type VoiceCheck = 'ok' | 'short' | 'silent'
/**
 * 录完的语音能不能发。0 字节或不到 0.6 秒算太短；
 * 每秒不到 600 字节基本是没录到声音（选错了输入设备、麦克风被占用或静音）。
 */
export function checkVoice(bytes: number, seconds: number): VoiceCheck {
  if (!bytes || seconds < 0.6) return 'short'
  if (bytes < seconds * 600) return 'silent'
  return 'ok'
}
