import './polyfills' // 必须放在最前面：@solana/* 依赖 Node 的 Buffer
import './lib/storageMigrate' // 必须第二：在任何 store 读存储之前把旧品牌前缀的存储键搬到 0x4.*
import './lib/chunkReload' // 发新版后旧页面拿不到旧分包：自动原地刷新一次（2026-10-02）
import './lib/reloadWatch' // 记录「被系统杀掉后自动重载」，要尽早跑，才能在别的代码之前读到上一次的心跳
import './lib/theme' // 尽早把深 / 浅色写到 <html data-theme>，避免先闪一下深色
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installKeyboardFollow } from './lib/keyboard'
import { installTapRipple } from './lib/tapRipple'
import { handleXAuthPopup } from './lib/xauth'
import { initPwaUpdate } from './lib/pwaUpdate'
import { createAppHistory } from './lib/pageTransition'
import { migrateLegacyUrl } from './lib/route'
import './index.css'
// 网页版外框样式（只在 html[data-surface="web"] / .desk-* 下生效，手机 App 里用不到）
import './desktop/desktop.css'
import './desktop/motion.css'
import './desktop/light.css'
import './desktop/space.css'
import { WEB_SURFACE } from './lib/surface'
// 首页顶栏「0x4」的像素字体（2026-09-29 goat：常规字体太普通）：打包进 App，原生离线也能显示；只取拉丁 600 一档
import '@fontsource/pixelify-sans/latin-600.css'
// 网页版正文字体 Geist（docs/WEB_DESIGN.md）：打包进来，不连 Google Fonts。手机 App 构建时 WEB_SURFACE 恒为 false，这行整个被删掉
if (WEB_SURFACE) void import('@fontsource-variable/geist/index.css')
// 浅色「液态玻璃」的环境光和鼠标反光（desktop/liquid.ts，2026-10-03）
if (WEB_SURFACE) void import('./desktop/liquid').then((m) => m.mountLiquid())
// 「空间」外观的虚化照片背景和视差（desktop/space.ts，2026-10-03）
if (WEB_SURFACE) void import('./desktop/space').then((m) => m.mountSpace())

// 网页版：从官网「Into the 0x4」过来的进场光（html.arrive，desktop/warp.js 在第一帧前加上），播完摘掉并清标记
if (WEB_SURFACE) {
  try {
    if (sessionStorage.getItem('0x4.warp')) {
      sessionStorage.removeItem('0x4.warp')
      setTimeout(() => document.documentElement.classList.remove('arrive'), 1400)
    }
  } catch { /* 隐私模式 */ }
}

// 网页版先把以前的 420.meme/app/#/xxx 地址原地换成 /xxx（lib/route.ts）。要在读地址参数的任何代码之前：
// 绑定 X 的授权窗口跳回来时地址带着 ?x=…，下一行就要读它
migrateLegacyUrl()
// 绑定 X 的授权窗口跳回来时：把结果交给原页面并关掉自己，不渲染界面
if (!handleXAuthPopup()) {
// 以前测试版写在本机的诊断记录，诊断工具删掉后清掉它
try { localStorage.removeItem('0x4.diag.log') } catch { /* 存储不可用 */ }
// 软键盘弹出时把输入框挪到键盘上方
installKeyboardFollow()
installTapRipple() // 全局按键水波纹，见 lib/tapRipple.ts
// 网页版：检查新版本，刚打开还没操作就自动换成新版，否则底部提示（原生 App 里是空操作）
initPwaUpdate()
// 路由：手机是 #/ 地址，电脑网页版是干净网址（lib/route.ts）；历史对象包了一层，页面切换时按方向播放过渡动画（lib/pageTransition.ts）。
// useTransitions={false}：路由状态同步更新，才能放进 View Transition 的回调里一次渲染完（原来默认包在 React startTransition 里）
const appHistory = createAppHistory()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HistoryRouter history={appHistory} useTransitions={false}>
        <App />
      </HistoryRouter>
    </ErrorBoundary>
  </StrictMode>,
)
}
