// Local storage rename: storage keys changed prefix when the brand became 0x4 (2026-09-25); this moves old-prefixed keys to 0x4.*.
// The old prefix must stay verbatim or old data can't be read; deleting this file would lose long-absent old users' wallets.
//
// ⚠️ Must run before any store: zustand's persist synchronously reads localStorage the moment a store is created (module import),
//    so in main.tsx this file is imported second, right after polyfills — never move it later.
// Old key exists, new key missing → move; delete the old key after moving. If the new key already exists (moved once), just delete the old key — never overwrite.
const OLD = 'fomo.'
const NEW = '0x4.'

try {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(OLD)) keys.push(k)
  }
  for (const k of keys) {
    const to = NEW + k.slice(OLD.length)
    const v = localStorage.getItem(k)
    if (v !== null && localStorage.getItem(to) === null) localStorage.setItem(to, v)
    localStorage.removeItem(k)
  }
} catch { /* Storage unavailable (incognito etc.): do nothing */ }

export {}
