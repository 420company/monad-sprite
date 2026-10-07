// 按键轻震（2026-09-29 goat：「现在基本手机钱包每次点击功能按键的时候，手机都会很快速轻微的振动一下」）。
// 只在原生 App 里生效，网页版不震。全局在 document 上挂一个捕获阶段的 click 监听，不用逐个按钮去加。
//
// 为什么用 click 不用 pointerdown：手指按下的那一刻还不知道是点按还是要开始滚动。按在列表行或按钮上开始滑动，
// pointerdown 会先震一下，滚一次页面震一次，很吵；click 只在真正点按（没有滑动、没有长按拖走）之后才触发，
// 滚动、长按拖动、在输入框里打字都不会有 click 落到按钮上，所以天然不震，和原生按钮的手感一致。
// 捕获阶段挂在 document 上：组件里 stopPropagation 也拦不住，保证每次点按都能收到。
//
// 重复震动的处理：组件自己调 tap() 的（比如录音开始），和这里落在同一次点按上时，由 tap() 的节流合成一次；
// 成功 / 失败用的是系统通知震动（hapticResult），更明显，照常保留，不被这里覆盖。
import { isNative, tap } from '@/lib/native'
import { useSettings } from '@/store/settings'

/** 算「功能按键」的元素 */
const PRESSABLE = [
  'button', 'a[href]', 'summary', 'select', 'label',
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="menuitem"]', '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]', '[role="option"]', '[role="radio"]', '[role="checkbox"]', '[role="link"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="button"]', 'input[type="submit"]',
  // 整块可点的卡片（比如动态正文点进详情）用 cursor-pointer 标出来；个别元素也可以加 data-haptic 手动打开
  '.cursor-pointer', '[data-haptic]',
].join(',')

/** 输入类：点进去是为了打字，不震 */
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]), textarea, [contenteditable=""], [contenteditable="true"]'

/** 这次点按该不该震：返回被点中的功能按键，不该震返回 null */
export function hapticTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[data-haptic="off"]')) return null
  if (target.closest(TYPING)) return null
  const el = target.closest(PRESSABLE)
  if (!el) return null
  // 禁用的按钮不震（点在禁用按钮里的图标、文字上，浏览器也会把 click 发到子元素）
  if (el.closest(':disabled, [aria-disabled="true"]')) return null
  // label 只在包着开关（勾选框、单选）时算按键；包着输入框的 label 点了是为了打字
  if (el instanceof HTMLLabelElement) {
    const c = el.control
    if (!(c instanceof HTMLInputElement) || (c.type !== 'checkbox' && c.type !== 'radio') || c.disabled) return null
  }
  return el
}

/** 在 App 根部调用一次；返回卸载函数。网页版直接不挂 */
export function installPressHaptics(doc: Document = document): () => void {
  if (!isNative) return () => {}
  const onClick = (e: MouseEvent) => {
    if (!useSettings.getState().pressHaptics) return
    if (hapticTarget(e.target)) tap()
  }
  doc.addEventListener('click', onClick, true)
  return () => doc.removeEventListener('click', onClick, true)
}
