// 网页版（VITE_SURFACE=web）宽屏 / 窄屏切换：≥ 900 走电脑端页面，窄屏（手机浏览器打开网页版）退回手机 App 的同一页。
import { useSyncExternalStore, type ReactNode } from 'react'

const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 900px)') : null

export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb) },
    () => !!mq?.matches,
    () => true,
  )
}

/** 宽屏渲染 desk，窄屏渲染 phone（两边都是完整页面，按屏幕宽度二选一） */
export function Wide({ desk, phone }: { desk: ReactNode; phone: ReactNode }) {
  return <>{useWide() ? desk : phone}</>
}
