// 全屏页式弹层（2026-09-18 用户定的：不要底部抽屉，要覆盖整屏、带返回和关闭）；原生 dialog 负责焦点隔离与层级，从右侧滑入。
import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { LiquidLayer } from '@/components/LiquidBackground'
import { createPortal } from 'react-dom'
import { ArrowLeft, X } from 'lucide-react'
import { ToastHost } from './Toast'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'
import { useWide } from '@/desktop/useWide'

const openSheets = new Set<HTMLDialogElement>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const topSheet = () => [...openSheets].at(-1)
const hiddenElements = new Map<HTMLElement, string | null>()
const notifyStack = () => {
  const top = topSheet()
  hiddenElements.forEach((value, element) => value === null ? element.removeAttribute('aria-hidden') : element.setAttribute('aria-hidden', value))
  hiddenElements.clear()
  if (top && typeof top.showModal !== 'function') {
    for (const element of document.body.children) {
      if (!(element instanceof HTMLElement) || element === top || element.tagName === 'SCRIPT') continue
      hiddenElements.set(element, element.getAttribute('aria-hidden'))
      element.setAttribute('aria-hidden', 'true')
    }
  }
  listeners.forEach(listener => listener())
}
let previousOverflow = ''
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = 'cubic-bezier(.2,.8,.2,1)'
// 半屏从底部升起：ease-out-cubic，前段不像上面那条冲得那么猛。WebKit 把动画交给系统合成要晚一两帧才上屏，
// 前段太陡的曲线（试过 iOS 底部弹层的 .32,.72,0,1）第一帧就已经升了一半，看着还是「闪」出来的
const halfEase = 'cubic-bezier(.33,1,.68,1)'

export default function Sheet({ open, onClose, title, children, dismissible = true, half: halfProp = false, center: centerProp = false }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; dismissible?: boolean
  /** 半屏：从底部升起、固定 60% 屏幕高，上面露出页面（直播间送礼用，要能看到直播）。
   *  ★ 固定高度而不是 max-h：内容异步加载（送礼的礼物列表、买卖的报价）时，按内容撑高的面板会在打开后突然往上长一截
   *  （2026-09-26 模拟器录屏：送礼面板先 417px 高，礼物列表到了跳成 524px）。内容多了在面板里滚动。 */
  half?: boolean
  /** 居中弹窗：屏幕正中间淡入放大，不贴底、不挡底部导航（发现页「更多链」这类短列表选择，2026-09-26 goat） */
  center?: boolean
}) {
  // 网页版宽屏（VITE_SURFACE=web，≥ 900px）：一律是居中模态框（docs/WEB_DESIGN.md：电脑端不许用手机底部弹层 / 整屏弹层），
  // 宽 440、圆角 14、实色面板、遮罩 60% 黑、不模糊背景；标题栏只有标题和关闭，没有手机的返回箭头。手机 App 不受影响（WEB_SURFACE 恒为 false）。
  const wide = useWide()
  const desk = WEB_SURFACE && wide
  const center = centerProp || desk
  const half = halfProp && !desk
  // 三种弹层的「收起 / 展开」位置：整屏从右侧滑入，半屏从底部升起，居中弹窗原地缩放淡入
  const OFF = center ? 'scale(.94)' : half ? 'translateY(100%)' : 'translateX(100%)'
  const ON = center ? 'scale(1)' : half ? 'translateY(0)' : 'translateX(0)'
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const fallback = useRef(false)
  const latest = useRef({ onClose, dismissible })
  latest.current = { onClose, dismissible }
  const closing = useRef(false)
  const animations = useRef<Animation[]>([])

  const stopAnimation = () => {
    const transform = panel.current ? getComputedStyle(panel.current).transform : 'none'
    const panelOpacity = panel.current ? getComputedStyle(panel.current).opacity : '1'
    const opacity = scrim.current ? getComputedStyle(scrim.current).opacity : '1'
    animations.current.forEach(animation => animation.cancel())
    animations.current = []
    if (panel.current) { panel.current.style.transform = transform; if (center) panel.current.style.opacity = panelOpacity }
    if (scrim.current) scrim.current.style.opacity = opacity
  }

  const moveTo = (transform: string, opacity: string, duration: number, done?: () => void) => {
    const easing = half || center ? halfEase : ease
    stopAnimation()
    if (!panel.current || !scrim.current) return
    if (reduceMotion() || duration === 0) {
      panel.current.style.transform = transform
      scrim.current.style.opacity = opacity
      done?.()
      return
    }
    // 居中弹窗除了缩放还要淡入淡出（从 0 透明到不透明），整屏 / 半屏只动位置
    const fade = center ? [{ opacity: panel.current.style.opacity || (transform === ON ? '0' : '1') }, { opacity: transform === ON ? '1' : '0' }] : null
    const a = panel.current.animate(fade ? [{ transform: panel.current.style.transform, ...fade[0] }, { transform, ...fade[1] }] : [{ transform: panel.current.style.transform }, { transform }], { duration, easing, fill: 'forwards' })
    const b = scrim.current.animate([{ opacity: scrim.current.style.opacity }, { opacity }], { duration, easing, fill: 'forwards' })
    animations.current = [a, b]
    // ★ 不能只等 a.finished：动画被暂停（页面在后台、系统节流）或被取消时它不会按时到，
    //   关闭流程卡在半路，对话框以看不见的状态一直挡住整个页面。用定时器保底，谁先到算谁。
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (panel.current) {
        panel.current.style.transform = transform
        // 居中弹窗的淡入淡出也要落到最终值：原来只落了位置，取消动画后面板回到开场前设的透明度 0，
        // 看起来就是「打开半秒自己消失」，其实对话框还开着挡在页面上（2026-09-26 活动页 / 发现页「更多」）
        if (center) panel.current.style.opacity = transform === ON ? '' : '0'
      }
      if (scrim.current) scrim.current.style.opacity = opacity
      a.cancel(); b.cancel()
      if (animations.current[0] === a) animations.current = []
      done?.()
    }
    const timer = setTimeout(() => {
      if (animations.current[0] !== a) return   // 已被新的动画接替，不抢
      finish()
    }, duration + 150)
    a.finished.then(() => { if (animations.current[0] === a) finish() }).catch(() => {})
  }

  const close = (instant = false) => {
    if (closing.current || !latest.current.dismissible || !dialog.current?.hasAttribute('open')) return
    closing.current = true
    moveTo(OFF, '0', instant ? 0 : 180, () => {
      latest.current.onClose()
      // ★ 兜底：外层没把 open 置回 false 时，对话框会一直以模态方式开着但内容在屏幕外，
      //   整个页面被它挡住、什么都点不了（2026-09-24 真机现象）。等一拍还开着就直接关掉。
      setTimeout(() => {
        const modal = dialog.current
        if (modal?.hasAttribute('open') && closing.current) {
          if (typeof modal.close === 'function') modal.close()
          modal.removeAttribute('open')
          openSheets.delete(modal)
          notifyStack()
          if (!openSheets.size) document.body.style.overflow = previousOverflow
        }
      }, 400)
    })
  }

  useLayoutEffect(() => {
    const modal = dialog.current
    if (!open || !modal) return
    closing.current = false
    // ★ 2026-09-24 真机（iOS 26.6）实锤：面板起始在屏幕右侧外，给标题 focus 时 WebKit 无视 preventScroll，
    //   把对话框横向滚了一整屏去「露出」标题；面板滑到位后反而整个落在屏幕左侧外（left=-390），
    //   对话框仍模态开着 → 整页点不动。overflow-clip 让对话框不可滚；这里再兜一层：被滚偏就立刻滚回。
    const unscroll = () => {
      if (!modal.scrollLeft && !modal.scrollTop) return
      modal.scrollLeft = 0; modal.scrollTop = 0
    }
    modal.addEventListener('scroll', unscroll)
    if (!openSheets.size) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openSheets.add(modal)
    const keyboard = document.activeElement?.matches(':focus-visible')
    fallback.current = typeof modal.showModal !== 'function'
    // iOS 15.0-15.3 尚无 showModal；由本层接管焦点隔离与顶层关闭。
    if (fallback.current) {
      modal.setAttribute('open', '')
      modal.style.display = 'block'
      modal.style.zIndex = String(100 + openSheets.size)
    } else modal.showModal()
    heading.current?.focus({ preventScroll: true })
    notifyStack()
    // 头两帧面板放在最终位置、但完全透明：让 WebKit 先把面板内容画好（放在屏幕外它不画，见下面 start 的注释）
    if (panel.current) { panel.current.style.transform = 'none'; panel.current.style.opacity = '0' }
    if (scrim.current) scrim.current.style.opacity = '0'
    // ★ 进场动画等面板先画出来一帧再开始（2026-09-26 模拟器录屏实测）：弹层第一次上屏要把整块面板画出来
    //   （链列表几十个带阴影的按钮、图标），这一帧要 50–130ms。原来在这里直接开动画，动画时钟已经在走、
    //   画面却卡在第一帧，等画好时 220ms 的动画已过去一大半 → 看起来是面板「闪现」到位，没有升起 / 滑入的过程。
    //   第一版改成「先放在屏幕外等一帧」没用：录屏里面板仍然是一出现就到了 85% 的高度——屏幕外的部分 WebKit 不画，
    //   动画开始、面板进入屏幕时才去画。所以头两帧让面板停在最终位置但透明（内容照画、看不见），
    //   两次 requestAnimationFrame（= 那一帧已经提交）之后再瞬间挪到屏幕外、恢复不透明、开始动画。
    //   面板带 will-change: transform：一开始就是独立合成层，动画开始时不会再「升层」重画一遍。
    //   页面在后台时 rAF 不跑，用 120ms 定时器兜底，谁先到算谁。
    let started = false, raf1 = 0, raf2 = 0
    const start = () => {
      if (started) return
      started = true
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(startTimer)
      if (closing.current) return   // 还没开始就被关了：关闭动画已接手，面板保持透明即可
      if (panel.current) { panel.current.style.transform = OFF; panel.current.style.opacity = center ? '0' : '' }
      moveTo(ON, '1', keyboard ? 0 : half ? 320 : center ? 220 : 220)
    }
    const startTimer = setTimeout(start, 120)
    if (keyboard) start()
    else raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(start) })
    // ★ 看门狗：打开 1.5 秒后面板还在屏幕外、又不是在关闭中 = 卡住了（对话框开着但看不见，整页被挡住）。
    //   整屏弹层从右侧滑入，看横向；半屏弹层从底部升起，看纵向（横向永远在屏内，只看横向会漏判）。
    const offscreen = () => {
      const rect = panel.current?.getBoundingClientRect()
      if (!rect) return false
      const w = window.innerWidth, h = modal.getBoundingClientRect().bottom || window.innerHeight
      if (rect.left >= w - 2 || rect.right <= 2) return true
      // 半屏：面板顶边已经掉到可视区底部以下（或整体飞到上方）= 看不见
      return half && (rect.top >= h - 2 || rect.bottom <= 2)
    }
    const watchdog = setTimeout(() => {
      if (!panel.current || closing.current || !modal.hasAttribute('open')) return
      if (offscreen()) {
        unscroll()
        if (!offscreen()) return
        closing.current = true
        latest.current.onClose()
      }
    }, 1500)

    // visualViewport 随软键盘收缩；仅滚动弹层内部，保留背景阅读位置。
    let frame = 0
    const fitViewport = () => {
      const viewport = window.visualViewport
      modal.style.top = `${viewport?.offsetTop ?? 0}px`
      modal.style.height = `${viewport?.height ?? window.innerHeight}px`
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const active = document.activeElement
        const scroll = content.current
        if (!(active instanceof HTMLElement) || !scroll?.contains(active)) return
        const item = active.getBoundingClientRect(), area = scroll.getBoundingClientRect()
        if (item.bottom > area.bottom - 12) scroll.scrollTop += item.bottom - area.bottom + 12
        else if (item.top < area.top + 12) scroll.scrollTop -= area.top + 12 - item.top
      })
    }
    fitViewport()
    window.visualViewport?.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('scroll', fitViewport)
    window.addEventListener('resize', fitViewport)
    modal.addEventListener('focusin', fitViewport)
    const guardFocus = (event: FocusEvent) => {
      if (fallback.current && topSheet() === modal && event.target instanceof Node && !modal.contains(event.target)) heading.current?.focus({ preventScroll: true })
    }
    const escape = (event: KeyboardEvent) => {
      if (!fallback.current || topSheet() !== modal || event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); close(true)
    }
    if (fallback.current) {
      document.addEventListener('focusin', guardFocus)
      document.addEventListener('keydown', escape, true)
    }
    return () => {
      clearTimeout(watchdog)
      clearTimeout(startTimer); cancelAnimationFrame(raf1); cancelAnimationFrame(raf2)
      cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', fitViewport)
      window.visualViewport?.removeEventListener('scroll', fitViewport)
      window.removeEventListener('resize', fitViewport)
      modal.removeEventListener('focusin', fitViewport)
      document.removeEventListener('focusin', guardFocus)
      document.removeEventListener('keydown', escape, true)
      modal.removeEventListener('scroll', unscroll)
      animations.current.forEach(animation => animation.cancel())
      animations.current = []
      if (fallback.current) {
        modal.removeAttribute('open'); modal.style.display = 'none'
      } else modal.close()
      openSheets.delete(modal)
      notifyStack()
      if (!openSheets.size) document.body.style.overflow = previousOverflow
      if (fallback.current && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
    // 回调更新不会重开弹层，避免破坏焦点与拖动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])


  return createPortal(
    <dialog ref={dialog} role="dialog" aria-labelledby={id} aria-modal="true"
      className="fixed inset-x-0 bottom-auto m-0 h-dvh max-h-none w-full max-w-none overflow-clip border-0 bg-transparent p-0 text-fg outline-none backdrop:bg-transparent"
      onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(true) }}
      onKeyDown={event => {
        if (event.key !== 'Tab' || !dialog.current || event.target instanceof Element && event.target.closest('dialog') !== dialog.current) return
        const nodes = [...dialog.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [inert]') && el.getClientRects().length)
        const first = nodes[0], last = nodes.at(-1)
        if (!first) { event.preventDefault(); heading.current?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}>
      {open && <>
        <div ref={scrim} className={`absolute inset-0 ${desk ? 'bg-black/60' : half ? 'bg-black/15' : 'bg-black/45'}`} aria-hidden="true" onClick={() => close(false)} />
        <div className={`pointer-events-none relative flex h-full justify-center ${half ? 'items-end' : center ? 'items-center px-6' : ''}`}>
          <div ref={panel} data-sheet-panel className={desk
            ? 'desk-modal pointer-events-auto flex w-full max-w-[440px] max-h-[min(86dvh,780px)] flex-col overflow-hidden rounded-[14px] will-change-transform'
            : `pointer-events-auto flex will-change-transform w-full flex-col sheet-glass shadow-2xl ${half ? 'max-w-[480px] h-[60%] overflow-hidden rounded-t-3xl' : center ? 'max-w-[420px] max-h-[70%] overflow-hidden rounded-3xl' : 'max-w-[480px] h-full'}`}>
            {!desk && <LiquidLayer />}
            {desk ? (
              <header className="desk-modal-head">
                <h2 id={id} ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate outline-none">{title || t('详情')}</h2>
                <button type="button" disabled={!dismissible} onClick={event => close(event.detail === 0)} className="desk-modal-x" aria-label={t('关闭')} title={t('关闭')}><X size={18} /></button>
              </header>
            ) : (
            <header className={`flex shrink-0 items-center gap-2 border-b border-line px-3 pb-2 ${half || center ? 'pt-2' : 'pt-[max(8px,env(safe-area-inset-top))]'}`}>
              <button type="button" disabled={!dismissible} onClick={event => close(event.detail === 0)} className="icon-button" aria-label={t('返回')} title={t('返回')}><ArrowLeft size={22} /></button>
              <h2 id={id} ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate text-lg font-semibold outline-none">{title || t('详情')}</h2>
              <button type="button" disabled={!dismissible} onClick={event => close(event.detail === 0)} className="icon-button" aria-label={t('关闭')} title={t('关闭')}><X size={20} /></button>
            </header>
            )}
            <div ref={content} data-sheet-content className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 ${desk ? 'pb-5' : center ? 'no-scrollbar pb-5' : half ? 'no-scrollbar pb-[max(24px,env(safe-area-inset-bottom))]' : 'pb-[max(24px,env(safe-area-inset-bottom))]'}`}>{children}</div>
          </div>
        </div>
        <SheetFeedback modal={dialog} />
      </>}
    </dialog>, document.body,
  )
}

// 原生顶层会覆盖页面上的 ToastHost；只在最上层复用同一通知源。
function SheetFeedback({ modal }: { modal: RefObject<HTMLDialogElement | null> }) {
  const top = useSyncExternalStore(subscribe, topSheet)
  return top === modal.current ? <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none [&>div]:absolute [&>div]:top-[max(16px,env(safe-area-inset-top))]"><ToastHost /></div> : null
}
