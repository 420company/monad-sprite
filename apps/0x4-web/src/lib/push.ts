// 系统推送（App 里）：登录社交层后向系统要通知权限、拿设备令牌、登记到服务器；点通知跳到对应页面。
//
// 两道开关都开才工作，缺一个就整条跳过、不弹权限框：
//   1. 打包时 VITE_PUSH=1：原生那边配好了（iOS 有 aps-environment 权限，Android 放了 google-services.json）。
//      没配时调 register 在 iOS 上拿不到令牌，在 Android 上 Firebase 未初始化会报错，所以默认不打开。
//   2. 服务器 /api/push/config 说这个平台能发（APNs / FCM 密钥已填）。服务端发不了就别打扰用户要权限。
// 锁定钱包不注销（锁着也该收到通知）；只有删除钱包时才从服务器注销本设备。
// 用户在「我 → 通知」里关掉「允许推送」：本机记一个标记，从服务器注销本设备，之后登录也不再登记。
import { PushNotifications } from '@capacitor/push-notifications'
import { isNative, platform } from '@/lib/native'
import { api, getToken } from '@/lib/social'
import { pathForRef } from '@/lib/notifRef'
import { useLang } from '@/lib/i18n'

export const pushBuildEnabled = isNative && import.meta.env.VITE_PUSH === '1'

let deviceToken: string | null = null

const OFF_KEY = '0x4.pushOff'
/** 用户在设置里关掉了「允许推送」 */
export function pushOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false }
}
function setPushOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY) } catch { /* ignore */ }
}
let listening = false

/** App 启动时挂一次监听（点通知可能是冷启动，要在登录之前就挂上） */
export function initPush(onOpen: (path: string) => void): void {
  if (!pushBuildEnabled || listening) return
  listening = true
  PushNotifications.addListener('registration', ({ value }) => {
    deviceToken = value
    if (getToken() && !pushOff()) void api('/api/push/register', { method: 'POST', body: JSON.stringify({ token: value, platform, lang: useLang.getState().lang }) }).catch(() => {})
  })
  PushNotifications.addListener('registrationError', () => { deviceToken = null })
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    // iOS 的自定义字段在 data 顶层；Android FCM 的 data 也在这里
    onOpen(pathForRef((notification.data as { ref?: string } | undefined)?.ref))
  })
}

/** 社交层登录成功后调用 */
export async function registerPush(): Promise<void> {
  if (!pushBuildEnabled || pushOff()) return
  try {
    const cfg = await api<{ ios: boolean; android: boolean }>('/api/push/config')
    if (!cfg[platform as 'ios' | 'android']) return
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      // 权限框会让 App 短暂失去前台，自动锁定设成「立即」时会把钱包锁掉
      const { suspendAutoLock, resumeAutoLock } = await import('@/lib/autolock')
      suspendAutoLock()
      try { perm = await PushNotifications.requestPermissions() } finally { resumeAutoLock() }
    }
    if (perm.receive !== 'granted') return
    // 令牌已拿到过（换钱包重新登录）就直接登记；否则 register 之后在 registration 回调里登记
    if (deviceToken) await api('/api/push/register', { method: 'POST', body: JSON.stringify({ token: deviceToken, platform, lang: useLang.getState().lang }) })
    else await PushNotifications.register()
  } catch { /* 推送是锦上添花，失败不影响使用 */ }
}

/**
 * 把界面语言告诉服务器，推送正文按它渲染（zh-Hans / zh-Hant / en）。社交层登录后、切换语言时调用。
 * 带上本设备的推送令牌（有的话），同一账号不同手机可以各用各的语言；网页版没令牌，只记到账号上
 */
export function reportLang(): void {
  if (!getToken()) return
  void api('/api/me/lang', { method: 'POST', body: JSON.stringify({ lang: useLang.getState().lang, ...(deviceToken ? { token: deviceToken } : {}) }) }).catch(() => {})
}
useLang.subscribe((s, prev) => { if (s.lang !== prev.lang) reportLang() })

/** 删除钱包前调用：本设备不再收这个钱包的通知 */
export function unregisterPush(): void {
  if (!pushBuildEnabled || !deviceToken || !getToken()) return
  void api('/api/push/unregister', { method: 'POST', body: JSON.stringify({ token: deviceToken }) }).catch(() => {})
}

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

/** 设置页用：打包开没开、服务器能不能发、系统权限、用户开关 */
export async function pushStatus(): Promise<{ build: boolean; server: boolean | null; permission: PushPermission; off: boolean }> {
  const off = pushOff()
  if (!pushBuildEnabled) return { build: false, server: null, permission: 'unsupported', off }
  const server = await api<{ ios: boolean; android: boolean }>('/api/push/config').then((c) => !!c[platform as 'ios' | 'android'], () => null)
  const perm = await PushNotifications.checkPermissions().then((p) => p.receive, () => 'denied' as const)
  return { build: true, server, permission: perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'prompt', off }
}

/** 打开「允许推送」：请求系统权限并登记本设备 */
export async function enablePush(): Promise<void> {
  setPushOff(false)
  await registerPush()
}

/** 关闭「允许推送」：本设备不再收这个钱包的通知 */
export async function disablePush(): Promise<void> {
  setPushOff(true)
  if (!pushBuildEnabled || !deviceToken || !getToken()) return
  await api('/api/push/unregister', { method: 'POST', body: JSON.stringify({ token: deviceToken }) }).catch(() => {})
}
