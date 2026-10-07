// 原生外壳（Capacitor）适配：判断是否在 App 里、外部浏览器、深度链接、状态栏、震动
// 在网页里调用这些函数都是安全的空操作
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Clipboard } from '@capacitor/clipboard'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'
/** 深度链接方案：X 授权等外部流程完成后通过 meme.wallet.app://… 跳回 App */
export const DEEP_LINK_SCHEME = 'meme.wallet.app'  // 和包名相同（2026-10-01），别的 App 很难抢注同名方案

/** 打开外部链接：App 里用系统内置浏览器（SFSafariViewController / Chrome Custom Tab），网页里新开标签 */
// ⚠️ 打开外部浏览器 = App 切后台。要跳回 App 的流程（X 授权、钱包连接）传 holdUnlock，期间不自动锁定，
//    不然授权走到一半回来要重新解锁。普通浏览（游戏观察、别人的 X 主页、公告链接）不传，照常计时：
//    2026-09-28 GPT 审查 #2，原来所有链接都挂豁免、只有深度链接跳回才解除，用户直接关掉浏览器后自动锁定就一直失效。
//    现在豁免在浏览器关闭（browserFinished）或深度链接跳回（closeExternal）时一次性全部释放。
//    动态 import 是为了断开 autolock → native 的循环依赖。
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
 * 在 App 里全屏打开一个网页，和钱包页面完全隔开。网页里退回新开标签。
 * 2026-09-29 goat：观察模式要在 App 里直接看，不要系统浏览器那种弹层。
 * 为什么不把游戏页 iframe 嵌进钱包页面（9/28 审查 #2）：Capacitor 的原生接口不区分调用来自主页面还是嵌入页，
 * 嵌入的页面一旦被注入就能调到钱包签名。官方 InAppBrowser 的独立网页是另一个 WebView（iOS 另起 WKWebView，
 * 安卓默认跑在独立进程），都不挂 Capacitor 的原生接口，里面的页面碰不到钱包。isIsolated 显式写 true，别被改成共享进程。
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
  if (isNative) { try { await Browser.close() } catch { /* 已关闭 */ } }
  await releaseHolds()
}

/** 保存图片：App 里存进系统相册，网页里走浏览器下载 */
const PhotoSaver = registerPlugin<{ save(options: { data: string }): Promise<void> }>('PhotoSaver')

export async function saveImage(dataUrl: string, filename: string): Promise<void> {
  if (isNative) {
    // 相册权限弹窗会让 App 短暂失去前台，自动锁定设成「立即」时会把钱包锁掉
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
 * 复制到剪贴板。App 里走系统剪贴板（网页那套 navigator.clipboard 在 WKWebView 里
 * 受用户手势限制，点了也可能失败），网页版仍用浏览器接口。
 */
export async function copyText(text: string): Promise<void> {
  if (isNative) { await Clipboard.write({ string: text }); return }
  await navigator.clipboard.writeText(text)
}

/** 短时间内只震一次：全局按键轻震（lib/pressHaptics.ts）和组件里自己调的 tap() 可能落在同一次点按上，叠在一起会像连震两下 */
const TAP_GAP_MS = 60
/** 刚因为点按震过，紧接着的「提示」类轻震（复制成功之类）就不再补一下 */
const INFO_AFTER_TAP_MS = 300
let lastTapAt = -Infinity

/** 轻震动反馈（点按、复制等）。iOS 对应 UIImpactFeedbackGenerator light，Android 对应轻点 */
export function tap(): void {
  if (!isNative) return
  const now = Date.now()
  if (now - lastTapAt < TAP_GAP_MS) return
  lastTapAt = now
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

/** 较长的震动（来电响铃用）。网页版有 navigator.vibrate 就用，iOS Safari 没有就算了 */
export function vibrate(ms: number): void {
  if (isNative) { Haptics.vibrate({ duration: ms }).catch(() => {}); return }
  try { navigator.vibrate?.(ms) } catch { /* ignore */ }
}

/**
 * 「操作结果」震动开关：由 lib/notifyHaptics.ts 加载时接上用户设置。
 * 这里不直接读设置：native.ts 是底层模块，直接引设置存储会把整套存储和页面地址一起牵进来（不带页面环境的测试一加载就报错）
 */
let resultGate: () => boolean = () => true
export function setResultHapticsGate(fn: () => boolean): void { resultGate = fn }

/** 结果反馈：成功与失败用系统的两种震动模式，手感和其它 App 一致。设置里关了「操作结果」就不震 */
export function hapticResult(kind: 'success' | 'error' | 'info'): void {
  if (!isNative) return
  if (!resultGate()) return
  // 成功 / 失败用系统的通知震动，比点按那一下明显，照常震；提示类和点按同样是轻震，刚震过就不再重复
  if (kind === 'info') { if (Date.now() - lastTapAt >= INFO_AFTER_TAP_MS) tap(); return }
  Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Error }).catch(() => {})
}

/** 前台收到新提醒（私信、@ 我、小精灵等）：系统的「提醒」震动，和点按轻震、操作成功 / 失败的震动区分开。开关判断在 lib/notifyHaptics.ts */
export function hapticNotice(): void {
  if (!isNative) return
  Haptics.notification({ type: NotificationType.Warning }).catch(() => {})
}

/**
 * meme.wallet.app://settings?x=linked → /settings?x=linked
 * 不是本 App 的方案、或解析不了，返回 null（调用方忽略）
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

/** App 启动时调用一次：状态栏样式、收起启动图、注册深度链接 */
export function initNative(onDeepLink: (path: string) => void): void {
  if (!isNative) return
  // 状态栏文字颜色跟外观走（lib/theme.ts 已把结果写在 <html data-theme>）：浅色底用黑字
  StatusBar.setStyle({ style: document.documentElement.dataset.theme === 'light' ? Style.Light : Style.Dark }).catch(() => {})
  if (platform === 'android') StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  SplashScreen.hide().catch(() => {})
  // meme.wallet.app://settings?x=linked → 跳到 #/settings?x=linked
  App.addListener('appUrlOpen', ({ url }) => {
    const path = parseDeepLink(url)
    if (!path) return
    closeExternal()
    onDeepLink(path)
  })
  // Android 返回键 / 系统返回手势：先交给 App 里的返回逻辑（lib/swipeBack.ts：有弹窗先关弹窗，有返回按钮的页面和返回按钮走同一套）；
  // 它没接（标签页首页、解锁页等）才照旧：能后退就后退，到根页面就退到后台
  App.addListener('backButton', ({ canGoBack }) => {
    if (!window.dispatchEvent(new Event('0x4:back', { cancelable: true }))) return
    if (canGoBack) window.history.back(); else App.minimizeApp()
  })
}
