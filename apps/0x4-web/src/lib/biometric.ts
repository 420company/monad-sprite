// Biometric unlock.
//
// iOS: enabling and unlocking both complete natively — the web layer never gets the unlock password, nor the private key:
//   Enabling → Vault.enableBiometric(password): the password is only stored to the keychain after native verification
//   Unlock → Vault.unlockWithBiometric(): the password is taken from the Keychain and unlocks the vault directly in native code
//   Native implementation: ios/App/App/VaultPlugin.swift.
// Android: the vault still lives in the web layer; native only guards the password (encrypted by the fingerprint-bound Keystore key).
//   After fingerprint verification, hand the password back to the web layer to unlock the vault. See android/…/BiometricVaultPlugin.java.
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from '@/lib/native'
import { t } from '@/lib/i18n'

/** fingerprint / biometric are Android's: the OS only reports "strong biometrics available" without saying which — with a fingerprint sensor it's called fingerprint */
export type BiometryType = 'faceID' | 'touchID' | 'opticID' | 'fingerprint' | 'biometric' | 'none'

const Native = registerPlugin<{
  status(): Promise<{ available: boolean; biometry: BiometryType; enabled: boolean }>
  // Only Android has the three below
  store(o: { password: string }): Promise<{ enabled: boolean }>
  retrieve(o: { reason: string }): Promise<{ password: string }>
  clear(): Promise<{ enabled: boolean }>
}>('BiometricVault')

/** Whether this runtime has a native implementation. Web doesn't */
export const biometricSupported = isNative && (platform === 'ios' || platform === 'android')
/** Android: native keeps the password, the web layer unlocks the vault */
export const biometricAndroid = isNative && platform === 'android'

export const androidBiometric = {
  /** The password must have been verified before calling */
  store: (password: string) => Native.store({ password }),
  retrieve: async (reason: string) => (await Native.retrieve({ reason })).password,
  clear: () => Native.clear().then(() => undefined, () => undefined),
}

export interface BiometricStatus {
  /** The device supports biometrics and has some enrolled */
  available: boolean
  biometry: BiometryType
  /** The Keychain has an enabled entry */
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

/** For embedding in Chinese sentences: pad with spaces around terms containing English (Face ID), not around pure-Chinese ones (fingerprint). The caller trims stray leading/trailing spaces */
export function biometryWord(type: BiometryType): string {
  const label = biometryLabel(type)
  return /[A-Za-z]/.test(label) ? ` ${label} ` : label
}

/** The user proactively cancelled verification. The caller silently returns to password input on this — no error popup */
export class BiometricCancelled extends Error {}
/** The entry doesn't exist or is void (face / fingerprint changed, lock-screen password turned off). The caller should prompt to re-enable */
export class BiometricInvalidated extends Error {}

/** Translate native error codes into the two above; throw everything else as-is */
export function toBiometricError(e: unknown): Error {
  const code = (e as { code?: string }).code
  if (code === 'CANCELLED') return new BiometricCancelled(t('已取消'))
  if (code === 'NOT_FOUND' || e instanceof BiometricInvalidated) return new BiometricInvalidated(t('生物识别已失效'))
  return e instanceof Error ? e : new Error(t('验证失败'))
}
