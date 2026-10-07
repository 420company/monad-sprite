// @vitest-environment jsdom
// 通知震动（2026-09-29 goat：「在通知里也能设置哪些通知可以有震动，用户自己选开关」）：
// ① 默认值：私信、@ 我、小精灵、评论、礼物红包、官方公告、其他通知开；群聊新消息、新粉丝、点赞关
// ② 每类开关生效：开着震（系统「提醒」震动，不是按键轻震），关了不震；一串提醒挤在一起只震一次；App 在后台不震
// ③ 真实事件：收到通知 / 小精灵确认请求 / 群消息时按类别震；正在和这个人私聊时私信通知不震；@ 我的群消息不按「群聊新消息」重复震
// ④ 「按键震动」关掉后，成功 / 失败提示也不再震（2026-09-29 和「操作结果」合成一个开关）
// ⑤ 通知和震动合成一个开关：没单独存过的类别跟推送开关走；老设置里「按键震动」「操作结果」任一开着 → 合并后开
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // jsdom 没有 matchMedia，主题 / 弹层一加载就会调
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  }
})
const h = vi.hoisted(() => ({ impact: 0, notice: [] as string[] }))
vi.mock('@capacitor/core', async (orig) => {
  const actual = await orig<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => 'ios' } }
})
vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn(async () => { h.impact++ }),
    notification: vi.fn(async ({ type }: { type: string }) => { h.notice.push(type) }),
    vibrate: vi.fn(async () => {}),
  },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS', Error: 'ERROR', Warning: 'WARNING' },
}))

const { VIBE_DEFAULTS, VIBE_ROWS, notifyHaptic, resetNoticeThrottle, vibeKindOfNotif, vibeOn } = await import('./notifyHaptics')
const { hapticResult } = await import('./native')
const { useSettings } = await import('@/store/settings')
const { useSocial, handleSocketEvent } = await import('@/store/social')

let now = 1_000_000
const later = (ms: number) => { now += ms; vi.setSystemTime(now) }

beforeEach(() => {
  vi.useFakeTimers()
  later(10_000)
  h.impact = 0; h.notice = []
  resetNoticeThrottle()
  useSettings.setState({ notifyHaptics: {}, pushPrefsCache: {}, pressHaptics: true })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  location.hash = ''
})

describe('通知震动：类别与默认值', () => {
  it('默认值：和自己相关、要尽快处理的开；群聊普通消息、新粉丝、点赞关', () => {
    expect(VIBE_DEFAULTS).toEqual({ dm: true, mention: true, group: false, comment: true, gift: true, follow: false, like: false, fly: true, official: true, other: true })
    for (const [k] of VIBE_ROWS) expect(vibeOn(k)).toBe(VIBE_DEFAULTS[k])
    expect(VIBE_ROWS.map(([k]) => k).sort()).toEqual(Object.keys(VIBE_DEFAULTS).sort())
  })
  it('站内通知类型对应到类别；小精灵发来的系统通知算「小精灵」', () => {
    expect(vibeKindOfNotif('dm')).toBe('dm')
    expect(vibeKindOfNotif('mention')).toBe('mention')
    expect(vibeKindOfNotif('packet')).toBe('gift')
    expect(vibeKindOfNotif('friend')).toBe('follow')
    expect(vibeKindOfNotif('system', 'fly:fly_abc')).toBe('fly')
    expect(vibeKindOfNotif('system', 'group:g1')).toBe('other')
    expect(vibeKindOfNotif('join_request', null)).toBe('other')
  })
})

describe('通知震动：开关', () => {
  it('开着的类别震一次「提醒」震动（不是按键轻震）；关掉后不震', () => {
    notifyHaptic('dm')
    expect(h.notice).toEqual(['WARNING'])
    expect(h.impact).toBe(0)
    useSettings.getState().setNotifyHaptic('dm', false)
    later(5000); notifyHaptic('dm')
    expect(h.notice).toHaveLength(1)
  })
  it('默认关的群聊新消息不震；用户打开后震', () => {
    notifyHaptic('group')
    expect(h.notice).toHaveLength(0)
    useSettings.getState().setNotifyHaptic('group', true)
    notifyHaptic('group')
    expect(h.notice).toHaveLength(1)
  })
  it('一串提醒挤在一起只震一次，隔开了再震', () => {
    notifyHaptic('dm'); notifyHaptic('mention'); later(500); notifyHaptic('fly')
    expect(h.notice).toHaveLength(1)
    later(2000); notifyHaptic('fly')
    expect(h.notice).toHaveLength(2)
  })
  it('App 在后台不震（交给系统推送）', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    notifyHaptic('dm')
    expect(h.notice).toHaveLength(0)
  })
  it('「按键震动」关掉后成功 / 失败提示也不震；打开时照常', () => {
    hapticResult('success')
    expect(h.notice).toEqual(['SUCCESS'])
    useSettings.getState().setPressHaptics(false)
    hapticResult('error'); hapticResult('success')
    expect(h.notice).toEqual(['SUCCESS'])
  })
  it('没单独存过的类别跟推送开关走；单独存过的照存的（老版本关过震动的保留）', () => {
    expect(vibeOn('follow')).toBe(false)                      // 默认值
    useSettings.getState().setPushPrefsCache({ follow: true, dm: false })
    expect(vibeOn('follow')).toBe(true)                       // 推送开了 → 震动也开
    expect(vibeOn('dm')).toBe(false)
    useSettings.getState().setNotifyHaptic('dm', true)
    expect(vibeOn('dm')).toBe(true)                           // 单独存过的优先
  })
  it('升级：「按键震动」「操作结果」任一开着 → 合并后开；两个都关 → 关；没存过 → 开', async () => {
    const { migrateSettings } = await import('@/store/settings')
    expect(migrateSettings({ pressHaptics: false, resultHaptics: true }, 0).pressHaptics).toBe(true)
    expect(migrateSettings({ pressHaptics: true, resultHaptics: false }, 0).pressHaptics).toBe(true)
    expect(migrateSettings({ pressHaptics: false, resultHaptics: false }, 0).pressHaptics).toBe(false)
    expect(migrateSettings({}, 0).pressHaptics).toBe(true)
    expect('resultHaptics' in migrateSettings({ resultHaptics: false }, 0)).toBe(false)
    expect(migrateSettings({ pressHaptics: false }, 1).pressHaptics).toBe(false)   // 已经是新版本的不动
  })
})

describe('通知震动：收到真实事件', () => {
  const me = '0xme00000000000000000000000000000000000001'
  const peer = '0xpeer000000000000000000000000000000000002'
  beforeEach(() => { useSocial.setState({ me: { address: me } as never, activeGroup: null, notifications: [], unreadNotifs: 0, messages: {}, lastMsg: {}, unreadGroup: {} }) })

  it('收到评论通知震；小精灵确认请求震；关掉「小精灵」后确认请求不震', async () => {
    await handleSocketEvent({ type: 'notify', n: { id: 1, type: 'comment', actor: peer, ref: 'post:1', text: 'x', read: 0, createdAt: now } })
    expect(h.notice).toHaveLength(1)
    later(2000); await handleSocketEvent({ type: 'fly_ask' })
    expect(h.notice).toHaveLength(2)
    useSettings.getState().setNotifyHaptic('fly', false)
    later(2000); await handleSocketEvent({ type: 'fly_ask' })
    expect(h.notice).toHaveLength(2)
  })
  it('正在和这个人私聊时，他的私信通知不震；在别的页面时震', async () => {
    location.hash = `#/dm/${peer}`
    await handleSocketEvent({ type: 'notify', n: { id: 2, type: 'dm', actor: peer, ref: `dm:${peer}`, text: 'x', read: 0, createdAt: now } })
    expect(h.notice).toHaveLength(0)
    location.hash = '#/community'
    later(2000); await handleSocketEvent({ type: 'notify', n: { id: 3, type: 'dm', actor: peer, ref: `dm:${peer}`, text: 'x', read: 0, createdAt: now } })
    expect(h.notice).toHaveLength(1)
  })
  it('群消息：打开「群聊新消息」后别人发的震；自己发的、正在看的群、@ 我的都不按这一类震', async () => {
    useSettings.getState().setNotifyHaptic('group', true)
    const msg = (id: string, from: string, extra: Record<string, unknown> = {}) => ({ type: 'msg', msg: { id, groupId: 'g1', from, text: 'hi', ts: now, ...extra } })
    await handleSocketEvent(msg('m1', peer))
    expect(h.notice).toHaveLength(1)
    later(2000); await handleSocketEvent(msg('m2', me))
    later(2000); await handleSocketEvent(msg('m3', peer, { mentions: [me] }))
    useSocial.setState({ activeGroup: 'g1' })
    later(2000); await handleSocketEvent(msg('m4', peer))
    expect(h.notice).toHaveLength(1)
  })
})

describe('通知面板（原生 App）', () => {
  it('每类通知一个开关（开 = 推送 + App 开着时震动），没有单独的「震动」分组；按键震动只剩一个开关', async () => {
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const social = await import('@/lib/social')
    const prefs = { dm: true, comment: true, mention: true, gift: true, follow: false, like: false, followPost: false, followPerp: false, followBuy: false, official: true }
    const apiSpy = vi.spyOn(social, 'api').mockImplementation((async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') Object.assign(prefs, JSON.parse(String(init.body)))
      return { ...prefs }
    }) as typeof social.api)
    useSocial.setState({ status: 'ready' } as never)
    const { default: NotificationSheet } = await import('@/components/NotificationSheet')
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(NotificationSheet, { open: true, onClose: () => {} })) })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[aria-label="震动"]')).toBeNull()
    expect(document.querySelector('[aria-label="收到提醒时震动"]')).toBeNull()
    const mine = document.querySelector('[aria-label="和我有关"]')!
    const rows = [...mine.querySelectorAll('[role="switch"]')]
    expect(rows.map((b) => b.querySelector('span')?.textContent)).toEqual(['私信', '群里 @ 我', '群聊新消息', '小精灵', '评论', '礼物和红包', '新粉丝', '点赞', '官方公告', '其他通知'])
    // 有推送的类别：一个开关同时改推送（服务器）和 App 开着时的震动（本机）
    const follow = rows.find((b) => b.textContent?.startsWith('新粉丝'))!
    expect(follow.getAttribute('aria-checked')).toBe('false')
    await act(async () => { (follow as HTMLButtonElement).click() })
    expect(prefs.follow).toBe(true)
    expect(useSettings.getState().notifyHaptics.follow).toBe(true)
    expect(vibeOn('follow')).toBe(true)
    // 没有推送的类别：只管 App 开着时震不震
    const group = rows.find((b) => b.textContent?.startsWith('群聊新消息'))!
    await act(async () => { (group as HTMLButtonElement).click() })
    expect(useSettings.getState().notifyHaptics.group).toBe(true)
    // 按键震动：只剩一个开关，没有「操作结果」
    const press = document.querySelector('[aria-label="按键震动"]')!
    expect(press.querySelectorAll('[role="switch"]')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('操作结果')
    act(() => root.render(null))
    apiSpy.mockRestore()
  })
})
