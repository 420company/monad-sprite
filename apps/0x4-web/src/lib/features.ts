// Feature flag (2026-09-27 goat): in-site balance features (balance & earnings page, top-up, withdraw, gift tips, balance red packets, balance transfers, paid adopt / renew)
// Never shown on phones. app.420.meme is currently the temporary "phone web build" before the phone app ships — treated the same as the native app.
// The future "web client" is a separate UI (with prediction markets, in-site wallet top-up/withdraw) — that build turns it on with VITE_BALANCE_FEATURES=1.
// Reason: buying virtual gifts with balance topped up outside the app, or transferring balance between users, must go through IAP per Apple review — or be treated as a payment service — either of which blocks store approval.
// These features are recorded in the whitepaper's "future plans" — see memory project_0x4_balance_features_future.

/** Whether in-site balance features are available: off by default (phones / app.420.meme) */
export const BALANCE_FEATURES = import.meta.env.VITE_BALANCE_FEATURES === '1'

/**
 * Perps trading (2026-10-02 goat): Apple's rule is that crypto futures trading must be submitted by a licensed financial institution, so the iOS store build ships without perps.
 * Not a line of code deleted: the iOS build sets VITE_NO_PERP=1 (npm run ios:store) to switch off the entry points — the perps page, the "Perps" button on home,
 * the sprite's perps mode and perps applications, perps-related fee / notification toggles / tips. Perps posts from others still read fine; tapping one returns home.
 * Web, Android, and dev builds keep it on by default. If a licensed partner comes along: rebuild without this variable and everything comes back as-is, no rewrite needed.
 */
export const PERP_ENABLED = import.meta.env.VITE_NO_PERP !== '1'

/**
 * Adopting sprites in the app (2026-10-02 goat: adoption is web-only): Apple rules say "holding an NFT must not unlock features in the app", nor may the app point users elsewhere to buy.
 * The iOS store build sets VITE_NO_ADOPT=1 (already in npm run ios:store): the sprite page only lists sprites you already have — no wallet NFT lookup,
 * no adopt button, no "Zalien is the key" copy, no "adopt on web" pointers. Already-adopted sprites still show and configure normally.
 * Web, Android, and dev builds keep it on by default.
 */
export const ADOPT_IN_APP = import.meta.env.VITE_NO_ADOPT !== '1'
