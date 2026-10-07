// Voice message recording formats and validation.
//
// Recording format order must put AAC (audio/mp4) before WebM:
// Since iOS 18.4, WKWebView's MediaRecorder also supports audio/webm;codecs=opus,
// WebM used to rank first; old iOS didn't support it so it fell through to mp4 and played; after the OS upgrade iOS records WebM,
// And WebKit's own WebM recordings (stream-written, no duration or index) play unreliably in iOS <audio>.
// AAC/MP4 is iOS's native format; Android and desktop browsers play it too.
// Desktop Chrome falls back to WebM when AAC encoding is unsupported; plain audio/mp4 in Chrome is Opus-in-MP4 — put last.
export const VOICE_MIME_PREFERENCE = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export function pickVoiceMime(isSupported: (t: string) => boolean): string {
  for (const t of VOICE_MIME_PREFERENCE) {
    try { if (isSupported(t)) return t } catch { /* Some browsers throw outright on unrecognized types */ }
  }
  return ''
}

/** How long holding the send key enters recording (ms) */
export const HOLD_TO_RECORD_MS = 2000
/** Max seconds per voice message */
export const VOICE_MAX_SECONDS = 60

export type VoiceCheck = 'ok' | 'short' | 'silent'
/**
 * Whether a finished voice recording may be sent. 0 bytes or under 0.6 seconds counts as too short;
 * under 600 bytes per second basically means no audio was captured (wrong input device, mic busy or muted).
 */
export function checkVoice(bytes: number, seconds: number): VoiceCheck {
  if (!bytes || seconds < 0.6) return 'short'
  if (bytes < seconds * 600) return 'silent'
  return 'ok'
}
