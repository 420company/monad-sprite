// 网页版干净网址（2026-10-02 goat：「网址看起来有点脏」）：420.meme/app/#/discover → 420.meme/discover。
// 只有电脑网页版（WEB_SURFACE，挂在 420.meme）这样；手机网页版 app.420.meme 和原生 App 仍是 #/ 地址（原生必须用 #）。
// · 托管那边把下面这些路径都转给网页版的 index.html（deploy/vercel/0x4-site.vercel.json，测试 route.test.ts 核对两边一致）；
// · 以前发出去的 420.meme/app/#/xxx 链接：网页版启动时原地换成 /xxx，不刷新、不丢参数（migrateLegacyUrl）；
// · 读「当前页面 + ?参数」一律用这里的 currentRoute / routeQuery，别直接读 location.hash。
import { WEB_SURFACE } from './surface'

export { APP_PREFIXES } from './appPrefixes'

/** 网页版的首页（官网 420.meme/ 是落地页，网页版从这里进）。2026-10-02 goat：进来先看热门行情，不是资产页（没连钱包的人看到的是一页空的） */
export const WEB_HOME = '/discover'

export const CLEAN_URLS = WEB_SURFACE

/** 当前页面路径（含 ?参数），两种地址都返回 '/discover?x=1' 这种形式 */
export function currentRoute(): string {
  return CLEAN_URLS ? location.pathname + location.search : (location.hash.replace(/^#/, '') || '/')
}

/** 当前页面的 ?参数 */
export function routeQuery(): URLSearchParams {
  return new URLSearchParams(currentRoute().split('?')[1] || '')
}

/** 把地址栏原地改成某个页面（不跳转、不刷新），比如处理完回调参数后去掉它们 */
export function replaceRoute(path: string) {
  history.replaceState(history.state, '', CLEAN_URLS ? path : location.pathname + location.search + '#' + path)
}

/**
 * 旧地址 → 干净地址：420.meme/app/、420.meme/app/#/token/bsc/0x..?a=1 → /discover、/token/bsc/0x..?a=1。
 * 在路由建起来之前调用（main.tsx）。只改地址栏，不刷新页面。
 */
export function legacyTarget(pathname: string, hash: string): string | null {
  if (pathname !== '/app' && !pathname.startsWith('/app/')) return null
  return hash.startsWith('#/') && hash.length > 2 ? hash.slice(1) : WEB_HOME
}
export function migrateLegacyUrl() {
  if (!CLEAN_URLS) return
  const to = legacyTarget(location.pathname, location.hash)
  if (to) history.replaceState(null, '', to)
}
