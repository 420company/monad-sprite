// After a new release, an open old page fetching the old build's chunk files fails (each release keeps only the new filenames):
// "TypeError: Failed to fetch dynamically imported module …/MeetingRoom-xxxx.js" (2026-10-02 goat hit this while creating a meeting).
// On this error, refresh in place once to fetch the new build — the URL stays the same (still the meeting / page you were headed to); if it fails again within 30 seconds (e.g. offline), stop refreshing and hand over to the fallback page.

const KEY = '0x4.chunkReload'
const WINDOW_MS = 30_000

/** Whether it's a "chunk file unavailable" class of error (wording differs per browser) */
export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(msg)
}

/** Reload once to pick up the new version; skip if already reloaded within 30s (return false, caller shows the error) */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* Storage unavailable: still refresh once */ }
  location.reload()
  return true
}

// Vite fires this event when preload of a dependency fails: intercept it and refresh directly, never letting the error surface in the UI
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => { if (reloadForNewVersion()) e.preventDefault() })
}
