// Guests (arriving via a share link, not logged in): can watch for 15 seconds, then the login sheet pops (2026-09-30 goat). Pure functions live here separately for easy testing
export const GUEST_FREE_MS = 15_000
export function guestGateOpen(elapsedMs: number, loggedIn: boolean): boolean { return !loggedIn && elapsedMs >= GUEST_FREE_MS }
