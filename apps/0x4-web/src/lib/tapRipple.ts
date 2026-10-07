// 全局按键「光晕」动效（2026-09-26 goat 在六个候选里选了 3 号：本体不动，按下时外沿呼出一圈同色柔光，松手慢慢收回）。
//
// 不改任何按钮组件：在 document 上抓 pointerdown，找到被按的按钮 / 链接按钮，给它加 .tap-halo；
// pointerup / pointercancel 时换成 .tap-halo-out 让光晕 0.5 秒淡出，然后摘掉类名。
// 光晕用 filter: drop-shadow 画在按钮自己的渲染结果外面：不占布局、不受按钮 overflow:hidden 裁剪、
// 不覆盖按钮原有的 box-shadow，也不用往按钮里塞元素。颜色走主题强调色（--color-accent）。
// 系统「减少动态效果」不放；disabled 的按钮不放。

const SELECTOR = 'button, [role="button"], a.ui-button, .ui-button, .icon-button, .welcome-cta, .pearl-button, .tab, .chip, .seg > *'

let installed = false

export function installTapRipple() {
  if (installed || typeof document === 'undefined') return
  installed = true
  let active: HTMLElement | null = null
  let timer = 0
  const release = () => {
    const el = active
    if (!el) return
    active = null
    el.classList.remove('tap-halo'); el.classList.add('tap-halo-out')
    window.clearTimeout(timer)
    timer = window.setTimeout(() => el.classList.remove('tap-halo-out'), 600)
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const target = e.target as Element | null
    const el = target?.closest?.(SELECTOR) as HTMLElement | null
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
    const cs = getComputedStyle(el)
    if (cs.display === 'inline' || cs.visibility === 'hidden') return
    release()
    active = el
    el.classList.remove('tap-halo-out'); el.classList.add('tap-halo')
  }, { passive: true, capture: true })
  document.addEventListener('pointerup', release, { passive: true, capture: true })
  document.addEventListener('pointercancel', release, { passive: true, capture: true })
}
