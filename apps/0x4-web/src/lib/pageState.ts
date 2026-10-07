// 页面 UI 状态的「会话内记忆」：标签、筛选、排序、搜索词、已加载条数这类东西。
// 以前都是组件里的 useState，页面一卸载（点进详情页）就丢，返回时回到默认的「首页状态」（2026-09-26 goat 反馈）。
// · 存在内存里，同时镜像到 sessionStorage 一个键（0x4.pageState）：WebView 被系统回收后重载也还在，关掉 App 就清空
// · 条目有上限，按最近使用淘汰（币详情、个人主页这类按对象记的状态会越积越多）
// · 读回来的值先过校验，写坏了 / 旧版本留下的不认识的值一律回到默认
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

export const PAGE_STATE_KEY = '0x4.pageState'
export const PAGE_STATE_MAX = 200

type Entry = [string, unknown]

export interface PageStateStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
  size(): number
}

/** storage 传 null = 只存内存（测试、存储不可用） */
export function createPageStateStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null, max = PAGE_STATE_MAX): PageStateStore {
  const map = new Map<string, unknown>()
  try {
    const raw = storage?.getItem(PAGE_STATE_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(list)) for (const e of list) if (Array.isArray(e) && typeof e[0] === 'string') map.set(e[0], e[1])
  } catch { /* 写坏了：当作空的 */ }
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    try { storage?.setItem(PAGE_STATE_KEY, JSON.stringify([...map.entries()] as Entry[])) } catch { /* 存不进去只影响重载后的恢复 */ }
  }
  // 连续输入搜索词时别每个字都序列化一遍
  const schedule = () => { if (storage && !timer) timer = setTimeout(flush, 150) }
  return {
    get: (key) => {
      if (!map.has(key)) return undefined
      const v = map.get(key)
      map.delete(key); map.set(key, v)   // 挪到最新
      return v
    },
    set: (key, value) => {
      if (map.get(key) === value && map.has(key)) return
      map.delete(key); map.set(key, value)
      while (map.size > max) map.delete(map.keys().next().value as string)
      schedule()
    },
    delete: (key) => { if (map.delete(key)) schedule() },
    clear: () => { map.clear(); try { storage?.removeItem(PAGE_STATE_KEY) } catch { /* 忽略 */ } },
    size: () => map.size,
  }
}

const sessionStore = (() => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null } })()
export const pageStore = createPageStateStore(sessionStore)

/** 校验器：值必须是给定选项之一 */
export const oneOf = <T extends string | number>(...values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
export const isString = (v: unknown): v is string => typeof v === 'string'
/** 正整数，最多到 max（已加载条数之类，防止被写成天文数字） */
export const posInt = (max = 10_000) => (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** 读一个记住的值；没有 / 不合法时用默认值 */
export function readPageState<T>(key: string, initial: T | (() => T), valid?: (v: unknown) => v is T, store: PageStateStore = pageStore): T {
  const v = store.get(key)
  if (v !== undefined && (!valid || valid(v))) return v as T
  return typeof initial === 'function' ? (initial as () => T)() : initial
}

/** 和 useState 一样用，只是值记在会话里：页面卸载后再回来还是原样。key 变了（换了一个币、一个人）就读那个 key 记住的值 */
export function usePageState<T>(key: string, initial: T | (() => T), valid?: (v: unknown) => v is T): [T, Dispatch<SetStateAction<T>>] {
  const [s, setS] = useState(() => ({ key, value: readPageState(key, initial, valid) }))
  let value = s.value
  if (s.key !== key) {
    value = readPageState(key, initial, valid)
    setS({ key, value })   // 渲染期间按新 key 同步一次（React 允许的写法）
  }
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setS((prev) => {
      const base = prev.key === key ? prev.value : readPageState(key, initial, valid)
      const v = typeof next === 'function' ? (next as (p: T) => T)(base) : next
      pageStore.set(key, v)
      return { key, value: v }
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set]
}
