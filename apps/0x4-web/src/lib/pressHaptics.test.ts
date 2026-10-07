// @vitest-environment jsdom
// 按键轻震（2026-09-29 goat：点功能按键手机要轻微震一下）：
// ① 原生 App 里点按钮 / 链接 / 开关 / 可点卡片震一次；点在按钮里的图标、文字上也算
// ② 禁用的、输入框、包着输入框的 label、聊天背景这类普通区域不震
// ③ 60 毫秒内只震一次（全局震动和组件自己调 tap() 落在同一次点按上不叠加）；刚点按过紧接的「提示」轻震不再补
// ④ 成功 / 失败的通知震动照常；「按键震动」关掉后不震
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ impact: 0, notification: 0 }))
vi.mock('@capacitor/core', async (orig) => {
  const actual = await orig<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => 'ios' } }
})
vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn(async () => { h.impact++ }),
    notification: vi.fn(async () => { h.notification++ }),
    vibrate: vi.fn(async () => {}),
  },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS', Error: 'ERROR' },
}))

const { installPressHaptics } = await import('./pressHaptics')
const { hapticResult, tap } = await import('./native')
const { useSettings } = await import('@/store/settings')

let uninstall: () => void
let now = 1_000_000
const later = (ms: number) => { now += ms; vi.setSystemTime(now) }
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const html = (s: string) => { document.body.innerHTML = s }
const $ = (sel: string) => document.querySelector(sel)!

beforeEach(() => {
  vi.useFakeTimers()
  later(10_000)   // 和上一个用例拉开距离，节流不串
  h.impact = 0; h.notification = 0
  useSettings.setState({ pressHaptics: true })
  uninstall = installPressHaptics()
})
afterEach(() => { uninstall(); document.body.innerHTML = ''; vi.useRealTimers() })

describe('按键轻震', () => {
  it('点按钮震一次；点在按钮里的图标上也算', () => {
    html('<button id="b"><svg id="icon"></svg><span id="txt">发送</span></button>')
    click($('#b'))
    expect(h.impact).toBe(1)
    later(100); click($('#icon'))
    later(100); click($('#txt'))
    expect(h.impact).toBe(3)
  })

  it('链接、标签页、开关、可点卡片都算功能按键', () => {
    html('<a id="a" href="/x">x</a><div id="tab" role="tab">t</div><div id="sw" role="switch" aria-checked="false"></div><div id="card" class="cursor-pointer"><p id="inner">正文</p></div>')
    for (const id of ['#a', '#tab', '#sw', '#inner']) { later(100); click($(id)) }
    expect(h.impact).toBe(4)
  })

  it('禁用的按钮（点在里面的文字上）和 aria-disabled 的不震', () => {
    html('<button id="b" disabled><span id="in">确认</span></button><div id="r" role="button" aria-disabled="true">x</div>')
    click($('#in'))
    later(100); click($('#r'))
    expect(h.impact).toBe(0)
  })

  it('输入框、文本框、包着输入框的 label、聊天背景不震', () => {
    html('<input id="i" /><textarea id="t"></textarea><label id="l">金额<input id="li" type="text" /></label><div id="bg"><p id="msg">一条消息</p></div><div class="cursor-pointer"><input id="ci" /><div id="ed" contenteditable="true">x</div></div>')
    for (const id of ['#i', '#t', '#l', '#msg', '#bg', '#ci', '#ed']) { later(100); click($(id)) }
    expect(h.impact).toBe(0)
  })

  it('包着勾选框的 label 算开关；浏览器转发给勾选框的那次点击不重复震', () => {
    html('<label id="l"><input id="c" type="checkbox" />记住</label>')
    ;($('#l') as HTMLLabelElement).click()   // jsdom 会像浏览器一样再给勾选框发一次 click
    expect(($('#c') as HTMLInputElement).checked).toBe(true)
    expect(h.impact).toBe(1)
  })

  it('60 毫秒内只震一次：全局和组件自己的 tap() 落在同一次点按上不叠加', () => {
    html('<button id="b">x</button>')
    click($('#b')); tap()
    later(30); click($('#b'))
    expect(h.impact).toBe(1)
    later(70); click($('#b'))
    expect(h.impact).toBe(2)
  })

  it('刚点按过，紧接的提示轻震不补；成功 / 失败的通知震动照常', () => {
    html('<button id="b">复制</button>')
    click($('#b'))
    later(120); hapticResult('info')
    expect(h.impact).toBe(1)
    hapticResult('success'); hapticResult('error')
    expect(h.notification).toBe(2)
    later(400); hapticResult('info')
    expect(h.impact).toBe(2)
  })

  it('「按键震动」关掉后不震，打开后恢复', () => {
    html('<button id="b">x</button>')
    useSettings.setState({ pressHaptics: false })
    click($('#b'))
    expect(h.impact).toBe(0)
    useSettings.setState({ pressHaptics: true })
    later(100); click($('#b'))
    expect(h.impact).toBe(1)
  })

  it('data-haptic="off" 可以单独关掉某一块', () => {
    html('<div data-haptic="off"><button id="b">x</button></div>')
    click($('#b'))
    expect(h.impact).toBe(0)
  })
})
