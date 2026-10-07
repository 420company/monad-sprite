// 软键盘随动（原生 App）。
//
// 2026-09-24 真机：解锁页密码框被键盘挡住。2026-09-25 goat：所有有输入框的页面都会被键盘盖住。
// 以前 iOS 用 resize: 'body'，只把 body 改矮，WebView 本身不变：
// 内容不满一屏的页面没有可滚动的余量，底部输入框只能留在键盘下面；h-dvh 的聊天页和弹层也不跟着变矮。
// 现在改成 resize: 'native'（capacitor.config.ts）：键盘弹出时整个 WebView 变矮，
// 100dvh / fixed 定位 / 弹层都自动落在键盘上方，这里只负责：
//   1. --kb-h = 键盘还压在页面上的那部分高度（WebView 已经让出来的不算，避免重复减）
//   2. html.kb-open：键盘打开期间隐藏浮动 Tab 栏，免得它顶在键盘上挡住输入框
//   3. 键盘弹出后把当前输入框滚到可见区域（页面和弹层里的内部滚动区域都算）
import { Keyboard } from '@capacitor/keyboard'
import { isNative } from '@/lib/native'

let baseline = 0 // 键盘收起时的视口高度
let kbHeight = 0

const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight

function update() {
  const root = document.documentElement
  const overlap = kbHeight ? Math.max(0, Math.round(kbHeight - (baseline - viewportHeight()))) : 0
  root.style.setProperty('--kb-h', `${overlap}px`)
  root.classList.toggle('kb-open', kbHeight > 0)
  return overlap
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement
}

function reveal() {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select, [contenteditable="true"]')) return
  const overlap = update()
  const scroller = scrollParent(el)
  const isRoot = scroller === document.scrollingElement || scroller === document.documentElement
  const vv = window.visualViewport
  const visTop = (vv?.offsetTop ?? 0) + (isRoot ? 0 : Math.max(0, scroller.getBoundingClientRect().top))
  let visBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - overlap
  if (!isRoot) visBottom = Math.min(visBottom, scroller.getBoundingClientRect().bottom)
  const r = el.getBoundingClientRect()
  // 多行输入框只保证光标所在的上半部分可见
  const bottom = Math.min(r.bottom, r.top + 120)
  let delta = 0
  if (bottom > visBottom - 16) delta = bottom - visBottom + 16
  else if (r.top < visTop + 12) delta = r.top - visTop - 12
  if (!delta) return
  scroller.scrollBy({ top: delta, behavior: 'smooth' })
}

// 网页版（手机浏览器打开 app.420.meme）：浏览器不会因为键盘把 100dvh 变矮，只有 visualViewport 会缩。
// 用它算出键盘压住的高度写进 --kb-h，聊天页 / 直播间的整屏布局减掉它，输入栏就落在键盘上方。
function installWebFollow() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const sync = () => {
    const overlap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    const open = overlap > 80 // 小于这个多半是地址栏收放，不是键盘
    root.style.setProperty('--kb-h', `${open ? overlap : 0}px`)
    root.classList.toggle('kb-open', open)
    // iOS Safari 聚焦时会把整页往上推，整屏布局下推上去的部分就成了空白，推回来
    if (open && vv.offsetTop > 0 && document.querySelector('[data-fullscreen-layout]')) window.scrollTo(0, 0)
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  document.addEventListener('focusin', () => setTimeout(() => { sync(); reveal() }, 300))
}

export function installKeyboardFollow() {
  if (!isNative) { installWebFollow(); return }
  baseline = viewportHeight()
  const onResize = () => { if (!kbHeight) baseline = viewportHeight(); else update() }
  window.addEventListener('resize', onResize)
  window.visualViewport?.addEventListener('resize', onResize)
  Keyboard.addListener('keyboardWillShow', (info) => { kbHeight = info.keyboardHeight; update() }).catch(() => {})
  // WebView 变矮有动画，等它结束再滚；再补一次防止第一次量到的是动画中间值
  Keyboard.addListener('keyboardDidShow', () => { requestAnimationFrame(reveal); setTimeout(reveal, 250) }).catch(() => {})
  Keyboard.addListener('keyboardWillHide', () => { kbHeight = 0; update() }).catch(() => {})
  // 键盘已经开着时切换到另一个输入框
  document.addEventListener('focusin', () => { if (kbHeight) setTimeout(reveal, 50) })
}
