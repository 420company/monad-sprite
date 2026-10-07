// Clean web URLs (2026-10-02 goat: "the URLs look dirty"): 420.meme/app/#/discover → 420.meme/discover.
// Desktop web only (WEB_SURFACE, served at 420.meme); phone web at app.420.meme and the native app keep #/ URLs (native requires #).
// - Hosting routes all these paths to web's index.html (deploy/vercel/0x4-site.vercel.json; route.test.ts checks both sides agree);
// - Previously shared 420.meme/app/#/xxx links: rewritten to /xxx in place at web startup, no reload, params kept (migrateLegacyUrl);
// - Always read "current page + ?params" via currentRoute / routeQuery here — never read location.hash directly.
import { WEB_SURFACE } from './surface'

export { APP_PREFIXES } from './appPrefixes'

/** Web's home (the 420.meme/ landing page is the website's; web enters here). 2026-10-02 goat: land on trending markets first, not the assets page (wallet-less visitors would see an empty page) */
export const WEB_HOME = '/discover'

export const CLEAN_URLS = WEB_SURFACE

/** Current page path (with ?params); both URL styles return the '/discover?x=1' form */
export function currentRoute(): string {
  return CLEAN_URLS ? location.pathname + location.search : (location.hash.replace(/^#/, '') || '/')
}

/** Current page's ?params */
export function routeQuery(): URLSearchParams {
  return new URLSearchParams(currentRoute().split('?')[1] || '')
}

/** Rewrite the address bar to a page in place (no navigation, no reload) — e.g. dropping callback params after handling them */
export function replaceRoute(path: string) {
  history.replaceState(history.state, '', CLEAN_URLS ? path : location.pathname + location.search + '#' + path)
}

/**
 * Legacy URL → clean URL: 420.meme/app/, 420.meme/app/#/token/bsc/0x..?a=1 → /discover, /token/bsc/0x..?a=1.
 * Called before the router is built (main.tsx). Only rewrites the address bar, no page reload.
 */
export function legacyTarget(pathname: string, hash: string): string | null {
  if (pathname !== '/app' && !pathname.startsWith('/app/')) return null
  return hash.startsWith('#/') && hash.length > 2 ? hash.slice(1) : WEB_HOME
}
export function migrateLegacyUrl() {
  if (!CLEAN_URLS) return
  const to = legacyTarget(location.pathname, location.hash)
  if (to) history.replaceState(null, '', to)
}
