// 电脑网页版各个页面的第一段路径（App.tsx 里的路由，2026-10-02 干净网址，见 lib/route.ts）。
// 加新页面要在这里登记，再同步 deploy/vercel/0x4-site.vercel.json（route.test.ts 会核对），否则刷新那个页面会 404。
// 这个文件不引用任何东西：vite.config.ts（本机开发服务器）也要用它。
/** 网页版各个页面的第一段路径（App.tsx 里的路由）。加新页面要在这里登记，否则刷新那个页面会 404 */
export const APP_PREFIXES = [
  'activity', 'approvals', 'community', 'discover', 'dm', 'earnings', 'energy', 'flies', 'fly', 'friends', 'g', 'groups', 'live', 'meet', 'meetings',
  'messages', 'notifications', 'official', 'onboarding', 'pc-login', 'perp', 'portfolio', 'post', 'rank', 'rewards', 'room', 'settings',
  'spot', 'support', 'swap', 'token', 'u', 'unlock', 'watch',
] as const
