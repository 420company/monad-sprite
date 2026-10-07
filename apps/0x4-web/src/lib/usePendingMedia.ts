// Sending images / videos (WeChat-style): appear in the chat list as "sending" the moment they're picked (local preview + circular progress),
// swapped for the official message after upload + send; failures stay in the list with a red exclamation — tap to resend (finished uploads aren't re-uploaded).
// Shared by groups and DMs: upload sends one file (plaintext for groups, encrypted for DMs); send posts the whole set as one message.
import { useCallback, useEffect, useRef, useState } from 'react'
import { mapLimit, mediaKindOf, UPLOAD_CONCURRENCY, type MediaKind } from './multiMedia'
import { toast } from '@/components/Toast'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export interface PendingFile { file: File; kind: MediaKind; local: string }
export interface PendingAlbum<U> {
  id: string; ts: number; items: PendingFile[]
  /** Per-file upload progress 0–1 */
  progress: number[]
  /** Finished upload results; skipped on resend */
  results: (U | undefined)[]
  state: 'uploading' | 'sending' | 'failed'
}

/** How long to wait for the server echo after sending; past that counts as failed (groups have no ack — only the echo) */
const ECHO_TIMEOUT = 20_000

export function usePendingMedia<U>(opts: {
  upload: (f: PendingFile, onProgress: (p: number) => void) => Promise<U>
  /** 'done': message already in the list (DMs show locally first) — remove directly; 'await': waiting for echo, call confirm to remove */
  send: (album: PendingAlbum<U>, results: U[]) => Promise<'done' | 'await'>
}) {
  const [list, setList] = useState<PendingAlbum<U>[]>([])
  const ref = useRef(list)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => () => { for (const x of timers.current.values()) clearTimeout(x) }, [])

  const patch = useCallback((id: string, fn: (a: PendingAlbum<U>) => PendingAlbum<U>) => {
    ref.current = ref.current.map((a) => (a.id === id ? fn(a) : a))
    setList(ref.current)
  }, [])
  const remove = useCallback((id: string) => {
    const tm = timers.current.get(id); if (tm) { clearTimeout(tm); timers.current.delete(id) }
    ref.current = ref.current.filter((a) => a.id !== id)
    setList(ref.current)
  }, [])

  const run = useCallback(async (id: string) => {
    const album = ref.current.find((a) => a.id === id)
    if (!album) return
    patch(id, (a) => ({ ...a, state: 'uploading' }))
    const todo = album.items.map((_, i) => i).filter((i) => album.results[i] === undefined)
    const settled = await mapLimit(todo, UPLOAD_CONCURRENCY, async (i) => {
      const r = await optsRef.current.upload(album.items[i], (p) => patch(id, (a) => { const progress = [...a.progress]; progress[i] = Math.min(0.99, p); return { ...a, progress } }))
      patch(id, (a) => { const progress = [...a.progress], results = [...a.results]; progress[i] = 1; results[i] = r; return { ...a, progress, results } })
      return r
    })
    if (!ref.current.some((a) => a.id === id)) return
    const bad = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined
    if (bad) {
      patch(id, (a) => ({ ...a, state: 'failed' }))
      toast.error(bad.reason instanceof Error ? bad.reason.message : t('上传失败'))
      return
    }
    patch(id, (a) => ({ ...a, state: 'sending' }))
    const cur = ref.current.find((a) => a.id === id)!
    try {
      const how = await optsRef.current.send(cur, cur.results as U[])
      if (how === 'done') { remove(id); return }
      timers.current.set(id, setTimeout(() => { timers.current.delete(id); patch(id, (a) => (a.state === 'sending' ? { ...a, state: 'failed' } : a)) }, ECHO_TIMEOUT))
    } catch (e) {
      patch(id, (a) => ({ ...a, state: 'failed' }))
      toast.error(errorText(e, t('发送失败')))
    }
  }, [patch, remove])

  /** Picked files (already capped at 9) → one sending message */
  const start = useCallback((files: File[]) => {
    const items = files.flatMap((file) => { const kind = mediaKindOf(file); return kind ? [{ file, kind, local: URL.createObjectURL(file) }] : [] })
    if (!items.length) return
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const album: PendingAlbum<U> = { id, ts: Date.now(), items, progress: items.map(() => 0), results: items.map(() => undefined), state: 'uploading' }
    ref.current = [...ref.current, album]
    setList(ref.current)
    void run(id)
  }, [run])

  const retry = useCallback((id: string) => { void run(id) }, [run])

  return { list, start, retry, confirm: remove }
}
