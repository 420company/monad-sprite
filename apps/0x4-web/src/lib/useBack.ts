// The page's top-left "back": go back when there's a previous page (nav(-1) — the previous page's tab / filter / scroll position all restore),
// pages opened directly from push / deep link / cold start have no previous page — go to a sensible parent instead (replacing the current entry, not stacking another).
import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { markNextNav } from './pageTransition'

/** HashRouter records this session's entry index in history.state.idx: 0 = the app's first page, no previous page */
export const canGoBack = (state: unknown = typeof window !== 'undefined' ? window.history.state : null): boolean =>
  typeof (state as { idx?: unknown } | null)?.idx === 'number' && (state as { idx: number }).idx > 0

/** The current page's registered parent: where the back gesture (lib/swipeBack.ts) and Android back key go with no previous page — same as the page's back button */
let fallbackPath: string | null = null
export const pageFallback = () => fallbackPath

export function useBack(fallback: string) {
  const nav = useNavigate()
  useEffect(() => {
    fallbackPath = fallback
    return () => { if (fallbackPath === fallback) fallbackPath = null }
  }, [fallback])
  // Tell the page-transition animation this is a "back" first: with no previous page the parent replaces the current one — without this it looks like a normal navigation and no back animation plays
  return useCallback(() => { markNextNav('back'); if (canGoBack()) nav(-1); else nav(fallback, { replace: true }) }, [nav, fallback])
}
