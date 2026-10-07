// Native shell (Capacitor) adapter: detect in-app, external browser, deep links, status bar, haptics
// Calling these functions on web is always a safe no-op
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Clipboard } from '@capacitor/clipboard'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'
/** Deep link scheme: external flows like X auth jump back to the app via meme.wallet.app://… */
export const DEEP_LINK_SCHEME = 'meme.wallet.app'  // Same as the package name (2026-10-01) — hard for other apps to squat the scheme

/** Open external links: in-app uses the system in-app browser (SFSafariViewController / Chrome Custom Tab), web opens a new tab */
// ⚠️ Opening the external browser = the app goes to background. Flows that must jump back to the app (X auth, wallet connect) pass holdUnlock to suspend auto-lock meanwhile,
//    otherwise returning mid-auth would demand an unlock again. Ordinary browsing (game spectate, someone's X profile, announcement links) doesn't pass it and the timer runs as usual:
//    2026-09-28 GPT review #2: previously every link got an exemption that only lifted on deep-link return — closing the browser directly left auto-lock broken forever.
//    Now all exemptions are released at once when the browser closes (browserFinished) or a deep link jumps back (closeExternal).
//    The dynamic import breaks the autolock → native circular dependency.
let holds = 0
let finishHooked = false
async function releaseHolds(): Promise<void> {
  if (!holds) return
  const n = holds
  holds = 0
  const { resumeAutoLock } = await import('@/lib/autolock')
  for (let i = 0; i < n; i++) resumeAutoLock()
}
export async function openExternal(url: string, opts: { holdUnlock?: boolean } = {}): Promise<void> {
  if (!isNative) { window.open(url, '_blank', 'noopener'); return }
  if (!finishHooked) { finishHooked = true; void Browser.addListener('browserFinished', () => { void releaseHolds() }).catch(() => { finishHooked = false }) }
  if (opts.holdUnlock) {
    const { suspendAutoLock } = await import('@/lib/autolock')
    suspendAutoLock()
    holds++
  }
  try {
    await Browser.open({ url, presentationStyle: 'popover' })
  } catch (e) {
    await releaseHolds()
    throw e
  }
}

/**
 * Open a web page full-screen in the app, fully isolated from the wallet page. Web falls back to a new tab.
 * 2026-09-29 goat: spectate mode should render directly in the app, not as a system-browser overlay.
 * Why not iframe the game page into the wallet page (9/28 review #2): Capacitor's native bridge doesn't distinguish calls from the main page vs an embedded page,
 * and an injected embedded page could reach wallet signing. The official InAppBrowser's isolated page is another WebView (a separate WKWebView on iOS,
 * a separate process by default on Android), neither carrying Capacitor's native bridge — pages inside can't touch the wallet. isIsolated is explicitly true; don't change it to shared process.
 */
export async function openInAppView(url: string, closeText: string): Promise<void> {
  if (!isNative) { window.open(url, '_blank', 'noopener'); return }
  const m = await import('@capacitor/inappbrowser')
  await m.InAppBrowser.openInWebView({
    url,
    options: {
      ...m.DefaultWebViewOptions,
      showURL: false,
      showToolbar: true,
      showNavigationButtons: false,
      closeButtonText: closeText,
      toolbarPosition: m.ToolbarPosition.TOP,
      iOS: { ...m.DefaultWebViewOptions.iOS, viewStyle: m.iOSViewStyle.FULL_SCREEN, animationEffect: m.iOSAnimation.CROSS_DISSOLVE },
      android: { ...m.DefaultWebViewOptions.android, isIsolated: true },
    },
  })
}

export async function closeExternal(): Promise<void> {
  if (isNative) { try { await Browser.close() } catch { /* Closed */ } }
  await releaseHolds()
}

/** Save image: into the system album in-app, browser download on web */
const PhotoSaver = registerPlugin<{ save(options: { data: string }): Promise<void> }>('PhotoSaver')

export async function saveImage(dataUrl: string, filename: string): Promise<void> {
  if (isNative) {
    // The album-permission popup briefly backgrounds the app — with auto-lock set to "immediately" it would lock the wallet
    const { suspendAutoLock, resumeAutoLock } = await import('@/lib/autolock')
    suspendAutoLock()
    try {
      await PhotoSaver.save({ data: dataUrl.replace(/^data:[^,]*,/, '') })
    } finally { resumeAutoLock() }
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Copy to clipboard. In-app uses the system clipboard (the web navigator.clipboard is gated by user gestures in WKWebView and may fail even on tap); web still uses the browser API.
 */
export async function copyText(text: string): Promise<void> {
  if (isNative) { await Clipboard.write({ string: text }); return }
  await navigator.clipboard.writeText(text)
}

/** Vibrate at most once in a short window: the global key-tap haptic (lib/pressHaptics.ts) and a component's own tap() can land on the same tap — stacked they'd feel like two buzzes */
const TAP_GAP_MS = 60
/** If a tap haptic just fired, a following "notice"-class light haptic (copy succeeded etc.) is skipped */
const INFO_AFTER_TAP_MS = 300
let lastTapAt = -Infinity

/** Light haptic feedback (taps, copy, etc.). iOS maps to UIImpactFeedbackGenerator light, Android to a light tap */
export function tap(): void {
  if (!isNative) return
  const now = Date.now()
  if (now - lastTapAt < TAP_GAP_MS) return
  lastTapAt = now
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

/** Longer vibration (for incoming-call ringtones). Web uses navigator.vibrate if available; iOS Safari doesn't have it — so be it */
export function vibrate(ms: number): void {
  if (isNative) { Haptics.vibrate({ duration: ms }).catch(() => {}); return }
  try { navigator.vibrate?.(ms) } catch { /* ignore */ }
}

/**
 * "Operation result" haptics switch: wired to the user setting at load time by lib/notifyHaptics.ts.
 * Not read directly here: native.ts is a low-level module, and importing the settings store directly would drag in the whole storage layer plus page addresses (tests without a page environment fail on load)
 */
let resultGate: () => boolean = () => true
export function setResultHapticsGate(fn: () => boolean): void { resultGate = fn }

/** Result feedback: success and failure use the system's two vibration patterns, feeling like other apps. Off if "operation results" is disabled in settings */
export function hapticResult(kind: 'success' | 'error' | 'info'): void {
  if (!isNative) return
  if (!resultGate()) return
  // Success / failure use the system notification vibration — stronger than a tap, always fired; notice-class uses the same light haptic as taps and is skipped if one just fired
  if (kind === 'info') { if (Date.now() - lastTapAt >= INFO_AFTER_TAP_MS) tap(); return }
  Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Error }).catch(() => {})
}

/** New alert while in foreground (DMs, @mentions, sprite, etc.): the system's "alert" vibration, distinct from tap haptics and success/failure haptics. The on/off decision lives in lib/notifyHaptics.ts */
export function hapticNotice(): void {
  if (!isNative) return
  Haptics.notification({ type: NotificationType.Warning }).catch(() => {})
}

/**
 * meme.wallet.app://settings?x=linked → /settings?x=linked
 * Returns null for other apps' schemes or unparseable URLs (callers ignore it)
 */
export function parseDeepLink(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null
    const path = '/' + (u.host + u.pathname).replace(/^\/+|\/+$/g, '') + u.search
    return path === '/' ? '/' : path
  } catch {
    return null
  }
}

/** Called once at app startup: status bar style, hide the splash, register deep links */
export function initNative(onDeepLink: (path: string) => void): void {
  if (!isNative) return
  // Status bar text color follows the theme (lib/theme.ts already wrote the result into <html data-theme>): dark text on light backgrounds
  StatusBar.setStyle({ style: document.documentElement.dataset.theme === 'light' ? Style.Light : Style.Dark }).catch(() => {})
  if (platform === 'android') StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  SplashScreen.hide().catch(() => {})
  // meme.wallet.app://settings?x=linked → jumps to #/settings?x=linked
  App.addListener('appUrlOpen', ({ url }) => {
    const path = parseDeepLink(url)
    if (!path) return
    closeExternal()
    onDeepLink(path)
  })
  // Android back key / system back gesture: first handed to the in-app back logic (lib/swipeBack.ts: open sheets close first; pages with a back button follow the same path as the button);
  // only if it declines (tab home pages, unlock page, etc.) does the default apply: go back if possible, background the app at the root page
  App.addListener('backButton', ({ canGoBack }) => {
    if (!window.dispatchEvent(new Event('0x4:back', { cancelable: true }))) return
    if (canGoBack) window.history.back(); else App.minimizeApp()
  })
}
