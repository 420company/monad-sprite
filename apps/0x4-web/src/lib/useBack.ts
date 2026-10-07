// 页面左上角的「返回」：有上一页就退回上一页（nav(-1)，上一页的标签 / 筛选 / 滚动位置都会还原），
// 从推送、深链、冷启动直接打开的页面没有上一页，就去一个合理的上级页面（替换当前记录，不多压一层）。
import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { markNextNav } from './pageTransition'

/** HashRouter 在 history.state.idx 里记着这是本次会话的第几条记录：0 = 打开 App 的第一页，没有上一页 */
export const canGoBack = (state: unknown = typeof window !== 'undefined' ? window.history.state : null): boolean =>
  typeof (state as { idx?: unknown } | null)?.idx === 'number' && (state as { idx: number }).idx > 0

/** 当前页面登记的上级页面：返回手势（lib/swipeBack.ts）和 Android 返回键没有上一页时去这里，和页面的返回按钮一致 */
let fallbackPath: string | null = null
export const pageFallback = () => fallbackPath

export function useBack(fallback: string) {
  const nav = useNavigate()
  useEffect(() => {
    fallbackPath = fallback
    return () => { if (fallbackPath === fallback) fallbackPath = null }
  }, [fallback])
  // 先告诉页面切换动画这是「返回」：没有上一页时是替换成上级页面，不说的话会被当成普通跳转，不播返回动画
  return useCallback(() => { markNextNav('back'); if (canGoBack()) nav(-1); else nav(fallback, { replace: true }) }, [nav, fallback])
}
