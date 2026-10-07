// 生物识别解锁。
//
// iOS：开启与解锁都在原生完成，网页层自始至终拿不到解锁密码，也拿不到私钥：
//   开启   → Vault.enableBiometric(密码)  原生验过密码才存进钥匙串
//   解锁   → Vault.unlockWithBiometric()  密码从钥匙串取出后直接在原生解金库
//   原生实现见 ios/App/App/VaultPlugin.swift。
// Android：金库还在网页层，原生只保管密码（指纹绑定的 Keystore 密钥加密），
//   验过指纹把密码交回网页层解金库。见 android/…/BiometricVaultPlugin.java。
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from '@/lib/native'
import { t } from '@/lib/i18n'

/** fingerprint / biometric 是 Android 的：系统只告诉「强生物识别可用」，分不清具体是什么，有指纹传感器就叫指纹 */
export type BiometryType = 'faceID' | 'touchID' | 'opticID' | 'fingerprint' | 'biometric' | 'none'

const Native = registerPlugin<{
  status(): Promise<{ available: boolean; biometry: BiometryType; enabled: boolean }>
  // 以下三个只有 Android 有
  store(o: { password: string }): Promise<{ enabled: boolean }>
  retrieve(o: { reason: string }): Promise<{ password: string }>
  clear(): Promise<{ enabled: boolean }>
}>('BiometricVault')

/** 这个运行环境有没有原生实现。网页没有 */
export const biometricSupported = isNative && (platform === 'ios' || platform === 'android')
/** Android：密码由原生保管、网页层解金库 */
export const biometricAndroid = isNative && platform === 'android'

export const androidBiometric = {
  /** 调用前须已验证过密码 */
  store: (password: string) => Native.store({ password }),
  retrieve: async (reason: string) => (await Native.retrieve({ reason })).password,
  clear: () => Native.clear().then(() => undefined, () => undefined),
}

export interface BiometricStatus {
  /** 设备支持并已录入生物特征 */
  available: boolean
  biometry: BiometryType
  /** 钥匙串里有已开启的条目 */
  enabled: boolean
}

const OFF: BiometricStatus = { available: false, biometry: 'none', enabled: false }

export async function biometricStatus(): Promise<BiometricStatus> {
  if (!biometricSupported) return OFF
  try { return await Native.status() } catch { return OFF }
}

export function biometryLabel(type: BiometryType): string {
  if (type === 'faceID') return t('面容 ID')
  if (type === 'touchID') return t('触控 ID')
  if (type === 'opticID') return t('视控 ID')
  if (type === 'fingerprint') return t('指纹')
  return t('生物识别')
}

/** 嵌进中文句子用：含英文的（面容 ID）两边补空格，纯中文的（指纹）不补。开头结尾多出的空格由调用方 trim */
export function biometryWord(type: BiometryType): string {
  const label = biometryLabel(type)
  return /[A-Za-z]/.test(label) ? ` ${label} ` : label
}

/** 用户主动取消验证。调用方据此静默回到密码输入，不弹错误 */
export class BiometricCancelled extends Error {}
/** 条目不存在或已作废（换了脸 / 指纹、关了锁屏密码）。调用方应提示重新开启 */
export class BiometricInvalidated extends Error {}

/** 把原生返回的错误码翻译成上面两种，其余原样抛出 */
export function toBiometricError(e: unknown): Error {
  const code = (e as { code?: string }).code
  if (code === 'CANCELLED') return new BiometricCancelled(t('已取消'))
  if (code === 'NOT_FOUND' || e instanceof BiometricInvalidated) return new BiometricInvalidated(t('生物识别已失效'))
  return e instanceof Error ? e : new Error(t('验证失败'))
}
