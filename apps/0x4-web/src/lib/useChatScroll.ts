// Chat list scrolling: scroll to the bottom when a new message arrives and the user is at the bottom (or sent it themselves); scroll to the top to load earlier ones, and hold the previous position without jumping once loaded.
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export function useChatScroll<T extends { id: string; from: string }>(list: T[], hasMore: boolean, loadOlder: () => Promise<unknown>, me?: string) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastId = useRef<string | undefined>(undefined)
  const firstId = useRef<string | undefined>(undefined)
  /** The height and position recorded when the upward turn was triggered; used to restore the position after the new page is inserted above */
  const restore = useRef<{ h: number; top: number } | null>(null)
  const busy = useRef(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  useLayoutEffect(() => {
    const el = box.current
    const first = list[0]?.id, last = list[list.length - 1]
    if (el) {
      if (restore.current && first !== firstId.current) {
        // Set the absolute value instead of adding the delta: the browser's built-in scroll anchoring already adjusted once and won't double-apply
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
      // Don't let this record linger into the next list change when nothing new was pulled
      setTimeout(() => { restore.current = null }, 300)
    })
  }, [hasMore, loadOlder])

  return { box, onScroll, loadingOlder }
}
