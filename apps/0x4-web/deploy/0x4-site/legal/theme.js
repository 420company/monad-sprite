// 静态页（下载 / 条款 / 隐私 / 风险）跟随网页版的午夜黑 / 香芋白（2026-10-03 goat：「为什么没有随着用户选择的颜色版本变化」）。
// 放在 <head> 里、不带 defer，第一帧前就定好，不会先黑一下再变白。
// 取值顺序：① 链接里带的 ?theme=light|dark（app.420.meme 和手机 App 跳过来时不同源，读不到本地存储，由它们带过来）；
// ② 本地存储 0x4.theme（和网页版同一个键，420.meme 同域读得到；auto 当没选）；③ 跟系统。
(function () {
  var th = ''
  try { var m = /[?&]theme=(light|dark)(?:&|$)/.exec(location.search); if (m) th = m[1] } catch (e) { /* 忽略 */ }
  if (!th) {
    try {
      var s = JSON.parse(localStorage.getItem('0x4.theme') || 'null')
      var v = s && s.state && s.state.setting
      if (v === 'light' || v === 'dark') th = v
      else if (v === 'space') th = 'dark'   // 网页版「空间」外观建在深色上，静态页按深色
    } catch (e) { /* 隐私模式读不到 */ }
  }
  if (!th) th = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', th)
})()
