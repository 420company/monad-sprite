// The profile page's three tabs (feed · trades · holdings): remembers the last selected one; next time anyone's profile opens, it lands on that tab.
// Storage keys carry the 0x4. prefix (consistent with other local settings). Falls back to "feed" when unreadable / corrupted / unpersistable in private mode.
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
  try { localStorage.setItem(PROFILE_TAB_KEY, tab) } catch { /* When persistence fails, falls back to the default next time — doesn't affect usage */ }
}
