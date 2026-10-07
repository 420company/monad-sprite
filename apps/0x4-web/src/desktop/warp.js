// Runs synchronously before the web app's (420.meme) first frame; vite.config.ts inlines it into <head> for VITE_SURFACE=web builds:
// 1. marks <html> with data-surface="web", which activates the web-only font and other rules in desktop/desktop.css;
// 2. arriving from the website's "Into the 0x4" (the website writes sessionStorage 0x4.warp = the light's center, e.g. "50% 88%", when the button is tapped):
//    the first frame already carries the same light as the website transition's end (html.arrive::after); main.tsx removes it after 1.4s. Does nothing under reduced motion.
try {
  document.documentElement.setAttribute('data-surface', 'web')
  // 3. midnight black / taro white (lib/theme.ts stores it in 0x4.theme): colors per the saved choice before the first frame, so taro-white users never see a black flash on open
  var th = JSON.parse(localStorage.getItem('0x4.theme') || 'null')
  document.documentElement.setAttribute('data-theme', th && th.state && th.state.setting === 'light' ? 'light' : 'dark')
  // The "space" appearance (dark + blurred photo background, 2026-10-03): marked before the first frame; space.ts lays the background image shortly after
  if (th && th.state && th.state.setting === 'space') document.documentElement.setAttribute('data-look', 'space')
  var at = sessionStorage.getItem('0x4.warp')
  if (at && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (/^\d{1,3}% \d{1,3}%$/.test(at)) document.documentElement.style.setProperty('--warp-at', at)
    document.documentElement.classList.add('arrive')
  }
} catch (e) { /* Private mode */ }
