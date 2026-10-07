// First path segment of each desktop web page (routes in App.tsx; 2026-10-02 clean URLs, see lib/route.ts).
// New pages must register here, then sync deploy/vercel/0x4-site.vercel.json (route.test.ts verifies) — otherwise refreshing that page 404s.
// This file imports nothing: vite.config.ts (the local dev server) uses it too.
/** First path segment of each web page (routes in App.tsx). New pages must register here, otherwise refreshing that page 404s */
export const APP_PREFIXES = [
  'activity', 'approvals', 'community', 'discover', 'dm', 'earnings', 'energy', 'flies', 'fly', 'friends', 'g', 'groups', 'live', 'meet', 'meetings',
  'messages', 'notifications', 'official', 'onboarding', 'pc-login', 'perp', 'portfolio', 'post', 'rank', 'rewards', 'room', 'settings',
  'spot', 'support', 'swap', 'token', 'u', 'unlock', 'watch',
] as const
