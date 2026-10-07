// 小精灵名字、用户昵称的规则（2026-09-28 goat 定）：只允许汉字、英文字母、数字，不能有空格和符号（含表情）；
// 长度按显示宽度算：一个汉字算 2，一个字母或数字算 1，合计不超过 16（最多 8 个汉字，或 16 个字母数字，也可以混用）。
// 服务器也按同一套规则校验（server/src/names.ts），这里只是提前在输入框里提示，不合规不让提交。
// 只在新建和修改时校验：以前起的名字、服务器自动生成的默认昵称（带「…」）不受影响。
import { t } from './i18n'

export const NAME_MAX_WIDTH = 16
const HAN = /\p{Script=Han}/u
const NAME_RE = /^[\p{Script=Han}A-Za-z0-9]+$/u

export function nameWidth(s: string): number {
  let w = 0
  for (const ch of s) w += HAN.test(ch) ? 2 : 1
  return w
}

/** 不合规返回一句给用户看的话；合规返回 null。nickname = 用在昵称上（提示里说「昵称」） */
export function nameError(s: string, nickname = false): string | null {
  if (!s) return nickname ? t('昵称不能为空') : t('名字不能为空')
  if (!NAME_RE.test(s)) return nickname ? t('昵称只能用汉字、英文字母和数字，不能有空格和符号') : t('名字只能用汉字、英文字母和数字，不能有空格和符号')
  if (nameWidth(s) > NAME_MAX_WIDTH) return nickname ? t('昵称最多 8 个汉字或 16 个字母数字') : t('名字最多 8 个汉字或 16 个字母数字')
  return null
}
