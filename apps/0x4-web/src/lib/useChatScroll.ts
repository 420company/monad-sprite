// 聊天列表滚动：新消息到了且人在底部（或是自己发的）就滚到底；滚到顶部加载更早的，加载完保持原来看的位置不跳。
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export function useChatScroll<T extends { id: string; from: string }>(list: T[], hasMore: boolean, loadOlder: () => Promise<unknown>, me?: string) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastId = useRef<string | undefined>(undefined)
  const firstId = useRef<string | undefined>(undefined)
  /** 触发往上翻时记下的高度和位置，新的一页插到上面之后按它把位置还原 */
  const restore = useRef<{ h: number; top: number } | null>(null)
  const busy = useRef(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  useLayoutEffect(() => {
    const el = box.current
    const first = list[0]?.id, last = list[list.length - 1]
    if (el) {
      if (restore.current && first !== firstId.current) {
        // 设绝对值而不是加差值：浏览器自带的滚动锚定已经调过一次也不会重复
        el.scrollTop = restore.current.top + (el.scrollHeight - restore.current.h)
        restore.current = null
      } else if (last?.id !== lastId.current && (atBottom.current || (me && last?.from === me))) {
        el.scrollTop = el.scrollHeight
        atBottom.current = true
      }
    }
    firstId.current = first
    lastId.current = last?.id
  }, [list, me])

  const onScroll = useCallback(() => {
    const el = box.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (el.scrollTop > 80 || !hasMore || busy.current) return
    busy.current = true
    restore.current = { h: el.scrollHeight, top: el.scrollTop }
    setLoadingOlder(true)
    loadOlder().catch(() => {}).finally(() => {
      busy.current = false
      setLoadingOlder(false)
      // 没拉到新东西时别让这个记录留到下一次列表变化
      setTimeout(() => { restore.current = null }, 300)
    })
  }, [hasMore, loadOlder])

  return { box, onScroll, loadingOlder }
}
