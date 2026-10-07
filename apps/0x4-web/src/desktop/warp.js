// 网页版（420.meme）第一帧前同步执行，由 vite.config.ts 在 VITE_SURFACE=web 构建时放进 <head>：
// 1. 给 <html> 标上 data-surface="web"，desktop/desktop.css 里网页版专用的字体等规则据此生效；
// 2. 从官网「Into the 0x4」过来（官网点按钮时写 sessionStorage 0x4.warp = 光心位置，如 "50% 88%"）：
//    第一帧就铺上和官网转场结尾一样的光（html.arrive::after），main.tsx 1.4 秒后摘掉。减弱动态效果时什么都不做。
try {
  document.documentElement.setAttribute('data-surface', 'web')
  // 3. 午夜黑 / 香芋白（lib/theme.ts 存在 0x4.theme）：第一帧前就按保存的选择上色，选了香芋白的人打开时不会先闪一下黑
  var th = JSON.parse(localStorage.getItem('0x4.theme') || 'null')
  document.documentElement.setAttribute('data-theme', th && th.state && th.state.setting === 'light' ? 'light' : 'dark')
  // 「空间」外观（深色 + 虚化照片背景，2026-10-03）：第一帧就标上，背景图由 space.ts 随后铺上
  if (th && th.state && th.state.setting === 'space') document.documentElement.setAttribute('data-look', 'space')
  var at = sessionStorage.getItem('0x4.warp')
  if (at && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (/^\d{1,3}% \d{1,3}%$/.test(at)) document.documentElement.style.setProperty('--warp-at', at)
    document.documentElement.classList.add('arrive')
  }
} catch (e) { /* 隐私模式 */ }
