// Sprite and user nickname rules (set by goat on 2026-09-28): only Chinese characters, Latin letters, and digits — no spaces or symbols (including emoji);
// length measured in display width: a Chinese character counts 2, a letter or digit counts 1, up to 16 total (max 8 Chinese characters, or 16 alphanumerics, or a mix).
// The server enforces the same rules (server/src/names.ts); this only pre-hints in the input box and blocks submission when non-compliant.
// Validated only on create and edit: older names and server-generated default nicknames (with "…") are unaffected.
import { t } from './i18n'

export const NAME_MAX_WIDTH = 16
const HAN = /\p{Script=Han}/u
const NAME_RE = /^[\p{Script=Han}A-Za-z0-9]+$/u

export function nameWidth(s: string): number {
  let w = 0
  for (const ch of s) w += HAN.test(ch) ? 2 : 1
  return w
}

/** Returns a user-facing message when non-compliant, null when compliant. nickname = used on nicknames (the hint says "nickname") */
export function nameError(s: string, nickname = false): string | null {
  if (!s) return nickname ? t('昵称不能为空') : t('名字不能为空')
  if (!NAME_RE.test(s)) return nickname ? t('昵称只能用汉字、英文字母和数字，不能有空格和符号') : t('名字只能用汉字、英文字母和数字，不能有空格和符号')
  if (nameWidth(s) > NAME_MAX_WIDTH) return nickname ? t('昵称最多 8 个汉字或 16 个字母数字') : t('名字最多 8 个汉字或 16 个字母数字')
  return null
}
