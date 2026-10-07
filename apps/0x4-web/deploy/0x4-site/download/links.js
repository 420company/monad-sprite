// 下载中心的链接（2026-10-01 goat：「所有东西设计好站位，最后只用改下载链接」）。
// 只改这一个文件：url 填上就显示「获取」按钮并跳过去；留空就按 status 显示「审核中」/「即将上线」。
//   extension：Chrome 网上应用店审核通过后填 https://chromewebstore.google.com/detail/bondmfeichdnhgcdgejiekphpoiahmdp
//   ios：App Store 上架后填 apps.apple.com 地址
//   android：Google Play 上架后填 play.google.com 地址
// 改完 `bash deploy/vercel-0x4-site.sh --prod` 发布。
window.OX4_DOWNLOADS = {
  // 2026-10-06 Chrome 网上应用店审核通过（0.5.1）
  extension: { url: 'https://chromewebstore.google.com/detail/0x4-wallet/bondmfeichdnhgcdgejiekphpoiahmdp', status: 'live' },
  ios: { url: '', status: 'soon' },
  android: { url: '', status: 'soon' },
}
