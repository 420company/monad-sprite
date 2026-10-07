// 个人主页的三个标签（动态 · 交易 · 持仓）：记住上次选的，下次打开谁的主页都停在那个标签。
// 存储键带 0x4. 前缀（和其它本地设置一致）。读不到 / 被写坏 / 隐私模式存不进去都回到「动态」。
export type ProfileTab = 'posts' | 'trades' | 'holdings'
export const PROFILE_TABS: readonly ProfileTab[] = ['posts', 'trades', 'holdings']
export const PROFILE_TAB_KEY = '0x4.profileTab'

export function loadProfileTab(): ProfileTab {
  try {
    const v = localStorage.getItem(PROFILE_TAB_KEY)
    return (PROFILE_TABS as readonly string[]).includes(v || '') ? (v as ProfileTab) : 'posts'
  } catch { return 'posts' }
}

export function saveProfileTab(tab: ProfileTab) {
  try { localStorage.setItem(PROFILE_TAB_KEY, tab) } catch { /* 存不进去下次回到默认，不影响使用 */ }
}
