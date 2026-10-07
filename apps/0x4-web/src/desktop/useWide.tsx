// Web (VITE_SURFACE=web) wide / narrow switching: ≥ 900 renders desktop pages; narrow (web opened in a phone browser) falls back to the mobile app's same page.
import { useSyncExternalStore, type ReactNode } from 'react'

const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 900px)') : null

export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb) },
    () => !!mq?.matches,
    () => true,
  )
}

/** Wide renders desk, narrow renders phone (both full pages — pick one by screen width) */
export function Wide({ desk, phone }: { desk: ReactNode; phone: ReactNode }) {
  return <>{useWide() ? desk : phone}</>
}
