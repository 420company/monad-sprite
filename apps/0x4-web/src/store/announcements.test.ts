// @vitest-environment jsdom
// 「0x4 官方」公告的实时事件：新公告插到最前面、未读 +1、重复事件不重复计；撤回删掉并按是否已读修正未读
import { beforeEach, describe, expect, it } from 'vitest'
import { handleAnnouncementEvent, useAnnouncements } from './announcements'

const a = (id: number) => ({ id, title: null, body: `第 ${id} 条`, image: null, link: null, createdAt: id * 1000 })

describe('公告实时事件', () => {
  beforeEach(() => useAnnouncements.getState().reset())

  it('新公告插到最前面，未读 +1，同一条再来不重复', () => {
    useAnnouncements.setState({ list: [{ ...a(1), read: true }], unread: 0, loaded: true })
    handleAnnouncementEvent({ type: 'announcement', a: a(2) })
    handleAnnouncementEvent({ type: 'announcement', a: a(2) })
    const s = useAnnouncements.getState()
    expect(s.list.map((x) => x.id)).toEqual([2, 1])
    expect(s.list[0].read).toBe(false)
    expect(s.unread).toBe(1)
  })

  it('撤回：没读过的减未读，读过的不减；不认识的 id 忽略', () => {
    useAnnouncements.setState({ list: [{ ...a(3), read: false }, { ...a(2), read: true }], unread: 1, loaded: true })
    handleAnnouncementEvent({ type: 'announcement_recall', id: 2 })
    expect(useAnnouncements.getState().unread).toBe(1)
    handleAnnouncementEvent({ type: 'announcement_recall', id: 3 })
    expect(useAnnouncements.getState().unread).toBe(0)
    expect(useAnnouncements.getState().list).toEqual([])
    handleAnnouncementEvent({ type: 'announcement_recall', id: 99 })
    expect(useAnnouncements.getState().unread).toBe(0)
  })

  it('别的事件类型不碰', () => {
    handleAnnouncementEvent({ type: 'msg', a: a(5) })
    expect(useAnnouncements.getState().list).toEqual([])
  })
})
