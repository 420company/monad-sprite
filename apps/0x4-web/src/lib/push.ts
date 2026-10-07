// System push (in-app): after social login, request notification permission from the OS, get the device token, register with the server; tapping a notification jumps to the matching page.
//
// Only works with both toggles on; missing either skips the whole thing without popping the permission dialog:
//   1. Built with VITE_PUSH=1: the native side is configured (iOS has the aps-environment entitlement, Android has google-services.json).
//      Calling register unconfigured gets no token on iOS and errors on Android with Firebase uninitialized — so it's off by default.
//   2. The server's /api/push/config says this platform can send (APNs / FCM keys filled in). If the server can't send, don't bother the user for permission.
// Locking the wallet doesn't unregister (notifications should still arrive while locked); the device is unregistered from the server only when the wallet is deleted.
// User turns off "allow push" under "Me → Notifications": record a local flag, unregister this device from the server, and never register again on later logins.
import { PushNotifications } from '@capacitor/push-notifications'
import { isNative, platform } from '@/lib/native'
import { api, getToken } from '@/lib/social'
import { pathForRef } from '@/lib/notifRef'
import { useLang } from '@/lib/i18n'

export const pushBuildEnabled = isNative && import.meta.env.VITE_PUSH === '1'

let deviceToken: string | null = null

const OFF_KEY = '0x4.pushOff'
/** The user turned off "allow push" in settings */
export function pushOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false }
}
function setPushOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY) } catch { /* ignore */ }
}
let listening = false

/** Attach the listener once at app launch (tapping a notification may be a cold start — it must be attached before login) */
export function initPush(onOpen: (path: string) => void): void {
  if (!pushBuildEnabled || listening) return
  listening = true
  PushNotifications.addListener('registration', ({ value }) => {
    deviceToken = value
    if (getToken() && !pushOff()) void api('/api/push/register', { method: 'POST', body: JSON.stringify({ token: value, platform, lang: useLang.getState().lang }) }).catch(() => {})
  })
  PushNotifications.addListener('registrationError', () => { deviceToken = null })
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    // iOS custom fields sit at the top level of data; Android FCM's data lands here too
    onOpen(pathForRef((notification.data as { ref?: string } | undefined)?.ref))
  })
}

/** Called after social login succeeds */
export async function registerPush(): Promise<void> {
  if (!pushBuildEnabled || pushOff()) return
  try {
    const cfg = await api<{ ios: boolean; android: boolean }>('/api/push/config')
    if (!cfg[platform as 'ios' | 'android']) return
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      // The permission dialog briefly takes the app out of the foreground; with auto-lock set to "immediately" it would lock the wallet
      const { suspendAutoLock, resumeAutoLock } = await import('@/lib/autolock')
      suspendAutoLock()
      try { perm = await PushNotifications.requestPermissions() } finally { resumeAutoLock() }
    }
    if (perm.receive !== 'granted') return
    // If the token was already obtained (re-login after switching wallets), register it directly; otherwise register inside the registration callback after register
    if (deviceToken) await api('/api/push/register', { method: 'POST', body: JSON.stringify({ token: deviceToken, platform, lang: useLang.getState().lang }) })
    else await PushNotifications.register()
  } catch { /* Push is a nice-to-have; failures don't affect usage */ }
}

/**
 * Tell the server the UI language so push bodies render in it (zh-Hans / zh-Hant / en). Called after social login and on language switch.
 * Bring this device's push token along (if any) — different phones on the same account can each use their own language; web has no token, it's just recorded on the account
 */
export function reportLang(): void {
  if (!getToken()) return
  void api('/api/me/lang', { method: 'POST', body: JSON.stringify({ lang: useLang.getState().lang, ...(deviceToken ? { token: deviceToken } : {}) }) }).catch(() => {})
}
useLang.subscribe((s, prev) => { if (s.lang !== prev.lang) reportLang() })

/** Called before deleting a wallet: this device no longer receives this wallet's notifications */
export function unregisterPush(): void {
  if (!pushBuildEnabled || !deviceToken || !getToken()) return
  void api('/api/push/unregister', { method: 'POST', body: JSON.stringify({ token: deviceToken }) }).catch(() => {})
}

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

/** For the settings page: whether the build enabled it, whether the server can send, OS permission, user toggle */
export async function pushStatus(): Promise<{ build: boolean; server: boolean | null; permission: PushPermission; off: boolean }> {
  const off = pushOff()
  if (!pushBuildEnabled) return { build: false, server: null, permission: 'unsupported', off }
  const server = await api<{ ios: boolean; android: boolean }>('/api/push/config').then((c) => !!c[platform as 'ios' | 'android'], () => null)
  const perm = await PushNotifications.checkPermissions().then((p) => p.receive, () => 'denied' as const)
  return { build: true, server, permission: perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'prompt', off }
}

/** Turning on "allow push": request OS permission and register this device */
export async function enablePush(): Promise<void> {
  setPushOff(false)
  await registerPush()
}

/** Turning off "allow push": this device no longer receives this wallet's notifications */
export async function disablePush(): Promise<void> {
  setPushOff(true)
  if (!pushBuildEnabled || !deviceToken || !getToken()) return
  await api('/api/push/unregister', { method: 'POST', body: JSON.stringify({ token: deviceToken }) }).catch(() => {})
}
